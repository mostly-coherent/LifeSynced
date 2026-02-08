#!/usr/bin/env python3
"""
Outlook Calendar ICS Feed Sync

Syncs Outlook Calendar appointments using ICS feed (no admin consent required).
This method requires publishing your calendar in Outlook on the Web.
"""

import os
import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Any, Optional

import requests
from icalendar import Calendar, Event
from icalendar.prop import vRecur
from dateutil.rrule import rrule, DAILY, WEEKLY, MONTHLY, YEARLY, MO, TU, WE, TH, FR, SA, SU
from dotenv import load_dotenv

from shared_db import CalendarDatabase
from timezone_utils import get_date_range, normalize_to_utc, parse_iso_datetime
from pathlib import Path

# Single env file at repo root (LifeSynced/.env.local)
_env_path = Path(__file__).resolve().parent / ".env.local"
load_dotenv(dotenv_path=_env_path)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

OUTLOOK_ICS_URL = os.getenv('OUTLOOK_ICS_URL')
DB_PATH = os.getenv('DB_PATH', 'calendar.db')

# Status words that indicate availability-only (not actual event titles)
STATUS_WORDS = {'Free', 'Busy', 'Tentative', 'Out of Office', 'Working Elsewhere'}


class CalendarSyncICS:
    """Sync Outlook calendar appointments from ICS feed to SQLite database."""
    
    def __init__(self, db_path: str = DB_PATH):
        self.db_path = db_path
        self.db = CalendarDatabase(db_path)
    
    def _fetch_ics(self, url: str) -> Optional[Calendar]:
        """Fetch ICS calendar from URL."""
        try:
            logger.info(f"Fetching ICS feed from: {url}")
            response = requests.get(url, timeout=30)
            response.raise_for_status()
            
            calendar = Calendar.from_ical(response.text)
            logger.info(f"Successfully fetched ICS calendar")
            return calendar
        except Exception as e:
            logger.error(f"Failed to fetch ICS feed: {e}")
            return None
    
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
            
            # Handle status words (availability-only events)
            if subject in STATUS_WORDS:
                # Try to use DESCRIPTION as subject
                description = str(event.get('DESCRIPTION', ''))
                if description and description not in STATUS_WORDS and len(description.strip()) > 0:
                    subject = description
                else:
                    # Prefix status word with brackets
                    subject = f"[{subject}]"
            
            # Get start and end times
            dtstart = event.get('DTSTART')
            dtend = event.get('DTEND')
            
            if not dtstart or not dtend:
                return None
            
            start_dt = dtstart.dt
            end_dt = dtend.dt
            
            # Handle all-day events
            # All-day events are date-only (not datetime objects)
            is_all_day = not isinstance(start_dt, datetime) or not isinstance(end_dt, datetime)
            
            # Calculate duration to detect multi-day events
            if isinstance(start_dt, datetime) and isinstance(end_dt, datetime):
                duration_hours = (end_dt - start_dt).total_seconds() / 3600
            else:
                # For date-only events, calculate days difference
                from datetime import date
                if isinstance(start_dt, date) and isinstance(end_dt, date):
                    duration_hours = (end_dt - start_dt).days * 24
                else:
                    duration_hours = 24  # Assume at least 1 day
            
            is_multi_day = duration_hours >= 24
            
            # Skip all-day or multi-day [Free] events from work calendar
            # These clutter the calendar and shouldn't trigger overlap detection
            if subject == '[Free]' and (is_all_day or is_multi_day):
                logger.debug(f"Skipping all-day/multi-day [Free] event: {uid}")
                return None
            
            if isinstance(start_dt, datetime):
                # Ensure timezone-aware
                if start_dt.tzinfo is None:
                    start_dt = start_dt.replace(tzinfo=timezone.utc)
                start_time = start_dt.isoformat()
            else:
                # Date-only (all-day event)
                start_time = start_dt.isoformat() + 'T00:00:00+00:00'
            
            if isinstance(end_dt, datetime):
                if end_dt.tzinfo is None:
                    end_dt = end_dt.replace(tzinfo=timezone.utc)
                end_time = end_dt.isoformat()
            else:
                # Date-only (all-day event)
                end_time = end_dt.isoformat() + 'T00:00:00+00:00'
            
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
                'source': 'ics'
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
                if start_dt.tzinfo is None:
                    start_dt = start_dt.replace(tzinfo=timezone.utc)
            else:
                # Date-only, convert to datetime
                start_dt = datetime.combine(start_dt, datetime.min.time()).replace(tzinfo=timezone.utc)
            
            # Get duration
            dtend = event.get('DTEND')
            duration = None
            if dtend:
                end_dt = dtend.dt
                if isinstance(end_dt, datetime):
                    if end_dt.tzinfo is None:
                        end_dt = end_dt.replace(tzinfo=timezone.utc)
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
                
                # Ensure timezone-aware
                if occurrence_start.tzinfo is None:
                    occurrence_start = occurrence_start.replace(tzinfo=timezone.utc)
                
                occurrence_end = occurrence_start + duration
                
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
                occurrence_data['end_time'] = occurrence_end.isoformat()
                
                occurrences.append(occurrence_data)
            
        except Exception as e:
            logger.warning(f"Error expanding recurring event: {e}")
        
        return occurrences
    
    def sync(self, days_back: int = 0, days_forward: int = 30) -> None:
        """Sync calendar appointments from ICS feed."""
        try:
            if not OUTLOOK_ICS_URL:
                logger.warning("OUTLOOK_ICS_URL not configured. Skipping ICS sync.")
                return
            
            logger.info("Starting Outlook Calendar sync (ICS Feed)")
            
            # Fetch ICS calendar
            calendar = self._fetch_ics(OUTLOOK_ICS_URL)
            if not calendar:
                logger.error("Failed to fetch ICS calendar")
                return
            
            # Get date range
            start_date, end_date = get_date_range(days_back, days_forward)
            cutoff_date = end_date + timedelta(days=1)  # Include events that start on end_date
            
            appointments = []
            
            # Process events
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
            
            logger.info(f"Parsed {len(appointments)} appointments from ICS feed")
            
            if appointments:
                deduplication_rules = {
                    'source': 'ics',
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
    if not OUTLOOK_ICS_URL:
        logger.error("OUTLOOK_ICS_URL must be set in .env.local")
        exit(1)
    
    sync = CalendarSyncICS()
    sync.sync()

