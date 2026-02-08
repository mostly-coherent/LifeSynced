#!/usr/bin/env python3
"""
Apple Calendar (iCloud) Sync

Syncs personal iCloud Calendar appointments to SQLite database.
Supports multiple methods:
1. iCloud.com Public Calendar Link (recommended)
2. ICS File Export
3. Direct Database Access (fallback)
"""

import os
import json
import logging
import sqlite3
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Any, Optional

import requests
from icalendar import Calendar, Event
from icalendar.prop import vRecur
from dateutil.rrule import rrule, DAILY, WEEKLY, MONTHLY, YEARLY, MO, TU, WE, TH, FR, SA, SU
from dotenv import load_dotenv

from shared_db import CalendarDatabase
from timezone_utils import get_date_range, normalize_to_utc, parse_iso_datetime, normalize_to_pacific
from pathlib import Path

# Single env file at repo root (LifeSynced/.env.local)
_env_path = Path(__file__).resolve().parent / ".env.local"
load_dotenv(dotenv_path=_env_path)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

APPLE_CALENDAR_ICS_URL = os.getenv('APPLE_CALENDAR_ICS_URL')
APPLE_CALENDAR_ICS_PATH = os.getenv('APPLE_CALENDAR_ICS_PATH')
APPLE_CALENDAR_DB_PATH = os.getenv('APPLE_CALENDAR_DB_PATH', os.path.expanduser('~/Library/Calendars/Calendar.sqlite'))
DB_PATH = os.getenv('DB_PATH', 'calendar.db')


def _parse_multiple_values(value: Optional[str]) -> List[str]:
    """Parse comma-separated values."""
    if not value:
        return []
    return [v.strip() for v in value.split(',') if v.strip()]


def _convert_webcal_to_https(url: str) -> str:
    """Convert webcal:// URL to https://."""
    if url.startswith('webcal://'):
        return url.replace('webcal://', 'https://', 1)
    return url


class AppleCalendarSync:
    """Sync Apple Calendar (iCloud) appointments to SQLite database."""
    
    def __init__(self, db_path: str = DB_PATH):
        self.db_path = db_path
        self.db = CalendarDatabase(db_path)
    
    def _fetch_from_ics_urls(self, urls: List[str], start_date: datetime, cutoff_date: datetime) -> List[Calendar]:
        """Fetch ICS calendars from URLs."""
        calendars = []
        
        for url in urls:
            try:
                # Convert webcal:// to https://
                url = _convert_webcal_to_https(url)
                
                logger.info(f"Fetching iCloud calendar from: {url}")
                response = requests.get(url, timeout=30)
                response.raise_for_status()
                
                calendar = Calendar.from_ical(response.text)
                calendars.append(calendar)
                logger.info(f"Successfully fetched calendar from URL")
            except Exception as e:
                logger.warning(f"Failed to fetch calendar from {url}: {e}")
        
        return calendars
    
    def _load_from_ics_files(self, paths: List[str]) -> List[Calendar]:
        """Load ICS calendars from files."""
        calendars = []
        
        for path in paths:
            try:
                expanded_path = os.path.expanduser(path)
                logger.info(f"Loading ICS file: {expanded_path}")
                
                with open(expanded_path, 'rb') as f:
                    calendar = Calendar.from_ical(f.read())
                    calendars.append(calendar)
                    logger.info(f"Successfully loaded calendar from file")
            except Exception as e:
                logger.warning(f"Failed to load calendar from {path}: {e}")
        
        return calendars
    
    def _load_from_database(self, db_path: str) -> List[Calendar]:
        """Load calendars from macOS Calendar.sqlite database (fallback)."""
        calendars = []
        
        try:
            expanded_path = os.path.expanduser(db_path)
            if not os.path.exists(expanded_path):
                logger.warning(f"Calendar database not found: {expanded_path}")
                return calendars
            
            logger.info(f"Loading calendars from database: {expanded_path}")
            
            with sqlite3.connect(expanded_path) as conn:
                cursor = conn.cursor()
                
                # Query calendar items
                cursor.execute('''
                    SELECT summary, start_date, end_date, location, description, url, all_day
                    FROM CalendarItem
                    WHERE start_date IS NOT NULL
                    ORDER BY start_date
                ''')
                
                # Note: This is a simplified approach. The actual Calendar.sqlite schema is complex.
                # For production use, prefer ICS URL or ICS file methods.
                # This method doesn't actually convert to Calendar objects - it's a placeholder.
            
            logger.warning("Direct database access is not fully implemented. Use ICS URL or file methods instead.")
            
        except Exception as e:
            logger.warning(f"Failed to load calendars from database: {e}")
        
        return calendars
    
    def _parse_ics_event(self, event: Event, base_uid: str) -> Optional[Dict[str, Any]]:
        """Parse ICS event into database record."""
        try:
            uid = str(event.get('UID', ''))
            if not uid:
                return None
            
            # Use base_uid for recurring events, full uid for single events
            event_id = base_uid if base_uid != uid else uid
            
            # Get subject/summary
            subject = str(event.get('SUMMARY', ''))
            
            # Get start and end times
            dtstart = event.get('DTSTART')
            dtend = event.get('DTEND')
            
            if not dtstart or not dtend:
                return None
            
            start_dt = dtstart.dt
            end_dt = dtend.dt
            
            # Normalize to Pacific timezone (fixes 1-hour offset issue in iCloud ICS feeds)
            if isinstance(start_dt, datetime):
                start_dt = normalize_to_pacific(start_dt)
            if isinstance(end_dt, datetime):
                end_dt = normalize_to_pacific(end_dt)
            
            # Handle all-day events
            # All-day events are date-only (not datetime objects)
            is_all_day = not isinstance(start_dt, datetime) or not isinstance(end_dt, datetime)
            
            if isinstance(start_dt, datetime):
                start_time = start_dt.isoformat()
            else:
                # Date-only (all-day event) - use Pacific timezone with proper DST handling
                pacific_dt = normalize_to_pacific(datetime.combine(start_dt, datetime.min.time()))
                start_time = pacific_dt.isoformat()
            
            if isinstance(end_dt, datetime):
                end_time = end_dt.isoformat()
            else:
                # Date-only (all-day event) - use Pacific timezone with proper DST handling
                pacific_dt = normalize_to_pacific(datetime.combine(end_dt, datetime.min.time()))
                end_time = pacific_dt.isoformat()
            
            # Get location
            location = str(event.get('LOCATION', ''))
            
            # Get organizer
            organizer = event.get('ORGANIZER', '')
            organizer_email = ''
            organizer_name = ''
            if organizer:
                organizer_email = str(organizer).replace('mailto:', '')
                organizer_name = str(event.get('ORGANIZER', {}).params.get('CN', '')) if hasattr(organizer, 'params') else ''
            
            # Get attendees
            attendees = []
            attendee_list = event.get('ATTENDEE', [])
            if not isinstance(attendee_list, list):
                attendee_list = [attendee_list]
            
            for attendee in attendee_list:
                if attendee:
                    attendee_email = str(attendee).replace('mailto:', '')
                    if attendee_email:
                        attendees.append(attendee_email)
            
            # Get description/body
            body_preview = str(event.get('DESCRIPTION', ''))
            if len(body_preview) > 500:
                body_preview = body_preview[:500] + '...'
            
            return {
                'id': event_id,
                'subject': subject,
                'start_time': start_time,
                'end_time': end_time,
                'location': location,
                'organizer_email': organizer_email,
                'organizer_name': organizer_name,
                'attendees': json.dumps(attendees),
                'body_preview': body_preview,
                'is_all_day': 1 if is_all_day else 0,
                'source': 'apple_calendar'
            }
        except Exception as e:
            logger.warning(f"Error parsing ICS event: {e}")
            return None
    
    def _parse_rrule(self, rrule_prop, dtstart: datetime, cutoff_date: datetime):
        """Parse RRULE property into a dateutil rrule object.
        
        This method parses vRecur properties directly instead of using rrulestr(),
        which is more robust and handles properties like WKST, UNTIL, INTERVAL, etc.
        """
        # Frequency mapping
        freq_map = {'DAILY': DAILY, 'WEEKLY': WEEKLY, 'MONTHLY': MONTHLY, 'YEARLY': YEARLY}
        day_map = {'MO': MO, 'TU': TU, 'WE': WE, 'TH': TH, 'FR': FR, 'SA': SA, 'SU': SU}
        
        # Get vRecur as dict if it's a vRecur object
        if hasattr(rrule_prop, 'items'):
            vrec = dict(rrule_prop)
        else:
            # Try to parse as string
            try:
                vrec = dict(vRecur.from_ical(str(rrule_prop)))
            except Exception:
                return None
        
        # Get frequency (required)
        freq_list = vrec.get('FREQ', [])
        if not freq_list:
            return None
        freq_str = freq_list[0] if isinstance(freq_list, list) else freq_list
        freq = freq_map.get(freq_str)
        if not freq:
            return None
        
        # Build rrule kwargs
        kwargs = {
            'freq': freq,
            'dtstart': dtstart
        }
        
        # Interval
        interval = vrec.get('INTERVAL', [1])
        kwargs['interval'] = interval[0] if isinstance(interval, list) else interval
        
        # Until (end date)
        until = vrec.get('UNTIL')
        if until:
            until_val = until[0] if isinstance(until, list) else until
            if isinstance(until_val, datetime):
                if until_val.tzinfo is None:
                    until_val = until_val.replace(tzinfo=timezone.utc)
                kwargs['until'] = until_val
            elif hasattr(until_val, 'date'):
                # It's a date, convert to datetime
                kwargs['until'] = datetime.combine(until_val, datetime.max.time()).replace(tzinfo=timezone.utc)
        else:
            # No UNTIL specified, use cutoff_date to limit expansion
            kwargs['until'] = cutoff_date
        
        # Count (number of occurrences)
        count = vrec.get('COUNT')
        if count:
            kwargs['count'] = count[0] if isinstance(count, list) else count
        
        # BYDAY (specific days of week)
        byday = vrec.get('BYDAY', [])
        if byday:
            byweekday = []
            for d in byday:
                d_str = str(d).upper()
                # Handle nth weekday like "1MO" (first Monday)
                if len(d_str) > 2 and d_str[-2:] in day_map:
                    n = int(d_str[:-2]) if d_str[:-2].lstrip('-').isdigit() else None
                    if n:
                        byweekday.append(day_map[d_str[-2:]](n))
                    else:
                        byweekday.append(day_map[d_str[-2:]])
                elif d_str in day_map:
                    byweekday.append(day_map[d_str])
            if byweekday:
                kwargs['byweekday'] = byweekday
        
        # BYMONTHDAY
        bymonthday = vrec.get('BYMONTHDAY')
        if bymonthday:
            kwargs['bymonthday'] = bymonthday if isinstance(bymonthday, list) else [bymonthday]
        
        # BYMONTH
        bymonth = vrec.get('BYMONTH')
        if bymonth:
            kwargs['bymonth'] = bymonth if isinstance(bymonth, list) else [bymonth]
        
        try:
            return rrule(**kwargs)
        except Exception as e:
            logger.warning(f"Failed to create rrule: {e}")
            return None
    
    def _expand_recurring_event(self, event: Event, start_date: datetime, cutoff_date: datetime) -> List[Dict[str, Any]]:
        """Expand recurring event (RRULE) into individual occurrences."""
        occurrences = []
        
        try:
            base_uid = str(event.get('UID', ''))
            if not base_uid:
                return occurrences
            
            dtstart = event.get('DTSTART')
            if not dtstart:
                return occurrences
            
            start_dt = dtstart.dt
            if isinstance(start_dt, datetime):
                # Normalize to Pacific timezone
                start_dt = normalize_to_pacific(start_dt)
            else:
                # Date-only, convert to datetime
                start_dt = datetime.combine(start_dt, datetime.min.time())
                # Normalize to Pacific
                start_dt = normalize_to_pacific(start_dt)
            
            # Get duration
            dtend = event.get('DTEND')
            duration = None
            if dtend:
                end_dt = dtend.dt
                if isinstance(end_dt, datetime):
                    # Normalize to Pacific
                    end_dt = normalize_to_pacific(end_dt)
                    duration = end_dt - start_dt
                else:
                    # Date-only
                    duration = timedelta(days=1)
            
            if not duration:
                duration = timedelta(hours=1)  # Default 1 hour
            
            # Get RRULE
            rrule_prop = event.get('RRULE')
            if not rrule_prop:
                return occurrences
            
            # Parse RRULE using vRecur properties directly (more robust than rrulestr)
            try:
                rule = self._parse_rrule(rrule_prop, start_dt, cutoff_date)
                if not rule:
                    return occurrences
            except Exception as e:
                logger.warning(f"Failed to parse RRULE: {e}")
                return occurrences
            
            # Generate occurrences
            for occurrence_start in rule.between(start_date, cutoff_date, inc=True):
                if not isinstance(occurrence_start, datetime):
                    continue
                
                # Normalize to Pacific timezone
                occurrence_start = normalize_to_pacific(occurrence_start)
                occurrence_end_adjusted = normalize_to_pacific(occurrence_start + duration)
                
                # Create event ID with timestamp
                timestamp = occurrence_start.strftime('%Y%m%dT%H%M%S')
                event_id = f"{base_uid}_{timestamp}"
                
                # Parse base event to get other fields
                base_event_data = self._parse_ics_event(event, base_uid)
                if not base_event_data:
                    continue
                
                # Update with occurrence times
                occurrence_data = base_event_data.copy()
                occurrence_data['id'] = event_id
                occurrence_data['start_time'] = occurrence_start.isoformat()
                occurrence_data['end_time'] = occurrence_end_adjusted.isoformat()
                
                occurrences.append(occurrence_data)
            
        except Exception as e:
            logger.warning(f"Error expanding recurring event: {e}")
        
        return occurrences
    
    def sync(self, days_back: int = 0, days_forward: int = 30) -> None:
        """Sync Apple Calendar appointments."""
        try:
            logger.info("Starting Apple Calendar sync")
            
            # Get date range
            start_date, end_date = get_date_range(days_back, days_forward)
            cutoff_date = end_date + timedelta(days=1)  # Include events that start on end_date
            
            calendars = []
            
            # Method 1: ICS URLs (recommended)
            if APPLE_CALENDAR_ICS_URL:
                urls = _parse_multiple_values(APPLE_CALENDAR_ICS_URL)
                calendars.extend(self._fetch_from_ics_urls(urls, start_date, cutoff_date))
            
            # Method 2: ICS Files
            if APPLE_CALENDAR_ICS_PATH:
                paths = _parse_multiple_values(APPLE_CALENDAR_ICS_PATH)
                calendars.extend(self._load_from_ics_files(paths))
            
            # Method 3: Direct Database (fallback - not fully implemented)
            if not calendars and APPLE_CALENDAR_DB_PATH:
                calendars.extend(self._load_from_database(APPLE_CALENDAR_DB_PATH))
            
            if not calendars:
                logger.warning("No calendars configured. Set APPLE_CALENDAR_ICS_URL or APPLE_CALENDAR_ICS_PATH in .env.local")
                return
            
            appointments = []
            
            # Process all calendars
            for calendar in calendars:
                for component in calendar.walk():
                    if component.name == 'VEVENT':
                        base_uid = str(component.get('UID', ''))
                        if not base_uid:
                            continue
                        
                        # Check if recurring event
                        rrule = component.get('RRULE')
                        
                        if rrule:
                            # Expand recurring event
                            occurrences = self._expand_recurring_event(component, start_date, cutoff_date)
                            appointments.extend(occurrences)
                        else:
                            # Single event
                            event_data = self._parse_ics_event(component, base_uid)
                            if event_data:
                                # Check if event is in date range
                                start_dt = parse_iso_datetime(event_data['start_time'])
                                if start_dt:
                                    start_utc = normalize_to_utc(start_dt)
                                    if start_date <= start_utc <= cutoff_date:
                                        appointments.append(event_data)
            
            logger.info(f"Parsed {len(appointments)} appointments from Apple Calendar(s)")
            
            if appointments:
                deduplication_rules = {
                    'source': 'apple_calendar',
                    'precedence': {'apple_calendar': 1},
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
    sync = AppleCalendarSync()
    sync.sync()

