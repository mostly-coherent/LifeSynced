#!/usr/bin/env python3
"""
Outlook Calendar Sync

Syncs Outlook Calendar appointments using Microsoft Graph API.
"""

import os
import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Any, Optional
from pathlib import Path

import msal
import requests
from dotenv import load_dotenv

from shared_db import CalendarDatabase
from timezone_utils import normalize_to_utc

# Single env file at repo root (LifeSynced/.env.local)
_env_path = Path(__file__).resolve().parent / ".env.local"
load_dotenv(dotenv_path=_env_path)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

CLIENT_ID = os.getenv('CLIENT_ID')
TENANT_ID = os.getenv('TENANT_ID')
DB_PATH = os.getenv('DB_PATH', 'calendar.db')

AUTHORITY = f'https://login.microsoftonline.com/{TENANT_ID}'
SCOPES = ['Calendars.Read', 'Calendars.Read.Shared']
GRAPH_ENDPOINT = 'https://graph.microsoft.com/v1.0'


def load_token_cache() -> msal.SerializableTokenCache:
    """Load token cache from file."""
    cache = msal.SerializableTokenCache()
    cache_file = Path('.token_cache.json')
    if cache_file.exists():
        cache.deserialize(cache_file.read_text())
    return cache


def save_token_cache(cache: msal.SerializableTokenCache) -> None:
    """Save token cache to file."""
    Path('.token_cache.json').write_text(cache.serialize())


def acquire_token_interactive(app: msal.PublicClientApplication) -> Optional[Dict[str, Any]]:
    """Acquire token using interactive browser flow."""
    accounts = app.get_accounts()
    result = None
    
    if accounts:
        # Try to get token silently first
        result = app.acquire_token_silent(SCOPES, account=accounts[0])
    
    if not result:
        # Interactive flow
        logger.info("No suitable token found. Opening browser for authentication...")
        result = app.acquire_token_interactive(scopes=SCOPES)
    
    return result


class CalendarSync:
    """Sync Outlook calendar appointments to SQLite database."""
    
    def __init__(self, db_path: str = DB_PATH):
        self.db_path = db_path
        self.db = CalendarDatabase(db_path)
        self.app = msal.PublicClientApplication(
            CLIENT_ID,
            authority=AUTHORITY,
            token_cache=load_token_cache()
        )
    
    def _fetch_appointments(self, start_date: Optional[datetime] = None, 
                           end_date: Optional[datetime] = None) -> List[Dict[str, Any]]:
        """Fetch appointments from Microsoft Graph API."""
        if not start_date:
            start_date = datetime.now(timezone.utc)
        if not end_date:
            end_date = start_date + timedelta(days=30)
        
        # Acquire token
        token_result = acquire_token_interactive(self.app)
        if not token_result or 'access_token' not in token_result:
            error = token_result.get('error_description', 'Unknown error')
            logger.error(f"Failed to acquire token: {error}")
            return []
        
        save_token_cache(self.app.token_cache)
        
        # Fetch calendar events
        headers = {
            'Authorization': f"Bearer {token_result['access_token']}",
            'Prefer': 'outlook.timezone="America/Los_Angeles"'
        }
        
        start_str = start_date.strftime('%Y-%m-%dT%H:%M:%SZ')
        end_str = end_date.strftime('%Y-%m-%dT%H:%M:%SZ')
        
        url = f'{GRAPH_ENDPOINT}/me/calendar/calendarView'
        params = {
            'startDateTime': start_str,
            'endDateTime': end_str,
            '$orderby': 'start/dateTime',
            '$top': 1000
        }
        
        all_appointments = []
        while url:
            response = requests.get(url, headers=headers, params=params)
            params = None  # Only use params for first request
            
            if response.status_code != 200:
                logger.error(f"Failed to fetch calendar: {response.status_code} - {response.text}")
                break
            
            data = response.json()
            events = data.get('value', [])
            
            for event in events:
                parsed = self._parse_appointment(event)
                if parsed:
                    all_appointments.append(parsed)
            
            # Check for next page
            url = data.get('@odata.nextLink')
        
        return all_appointments
    
    def _parse_appointment(self, event: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Parse Graph API event into database record."""
        subject = event.get('subject', '')
        is_all_day = event.get('isAllDay', False)
        
        start_time = event.get('start', {}).get('dateTime', '')
        end_time = event.get('end', {}).get('dateTime', '')
        
        # Calculate duration to detect multi-day events
        is_multi_day = False
        if start_time and end_time:
            try:
                from dateutil import parser
                start_dt = parser.isoparse(start_time)
                end_dt = parser.isoparse(end_time)
                duration_hours = (end_dt - start_dt).total_seconds() / 3600
                is_multi_day = duration_hours >= 24
            except Exception:
                pass
        
        # Skip all-day or multi-day "Free" events from work calendar
        # These clutter the calendar and shouldn't trigger overlap detection
        if subject == 'Free' and (is_all_day or is_multi_day):
            logger.debug(f"Skipping all-day/multi-day Free event: {event.get('id', '')}")
            return None
        
        organizer = event.get('organizer', {})
        organizer_email = organizer.get('emailAddress', {}).get('address', '')
        organizer_name = organizer.get('emailAddress', {}).get('name', '')
        
        attendees = event.get('attendees', [])
        attendee_emails = [
            att.get('emailAddress', {}).get('address', '')
            for att in attendees
            if att.get('emailAddress', {}).get('address')
        ]
        
        return {
            'id': event.get('id', ''),
            'subject': subject,
            'start_time': start_time,
            'end_time': end_time,
            'location': event.get('location', {}).get('displayName', '') if isinstance(event.get('location'), dict) else event.get('location', ''),
            'organizer_email': organizer_email,
            'organizer_name': organizer_name,
            'attendees': json.dumps(attendee_emails),
            'body_preview': event.get('bodyPreview', ''),
            'is_all_day': 1 if is_all_day else 0,
            'source': 'graph_api'
        }
    
    def sync(self, days_back: int = 0, days_forward: int = 30) -> None:
        """Sync calendar appointments."""
        try:
            logger.info("Starting Outlook Calendar sync (Graph API)")
            
            start_date = datetime.now(timezone.utc) - timedelta(days=days_back)
            end_date = datetime.now(timezone.utc) + timedelta(days=days_forward)
            
            appointments = self._fetch_appointments(start_date, end_date)
            logger.info(f"Fetched {len(appointments)} appointments from Graph API")
            
            if appointments:
                deduplication_rules = {
                    'source': 'graph_api',
                    'precedence': {'graph_api': 2, 'ics': 1},
                    'skip_same_source': False
                }
                saved, updated = self.db.save_appointments_batch(appointments, deduplication_rules)
                logger.info(f"Saved {saved} new appointments, updated {updated} existing appointments")
            else:
                logger.info("No appointments to save")
                
        except Exception as e:
            logger.error(f"Sync failed: {e}", exc_info=True)
            raise


if __name__ == '__main__':
    if not CLIENT_ID or not TENANT_ID:
        logger.error("CLIENT_ID and TENANT_ID must be set in .env.local")
        exit(1)
    
    sync = CalendarSync()
    sync.sync()
