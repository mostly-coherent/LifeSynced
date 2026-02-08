#!/usr/bin/env python3
"""
Sync All Calendars

Master script to sync all configured calendars (Outlook Graph API, Outlook ICS, iCloud).
"""

import os
import logging
from pathlib import Path
from dotenv import load_dotenv

# Import sync classes
from sync_calendar import CalendarSync
from sync_calendar_ics import CalendarSyncICS
from sync_apple_calendar import AppleCalendarSync

# Single env file at repo root (LifeSynced/.env.local)
_env_path = Path(__file__).resolve().parent / ".env.local"
load_dotenv(dotenv_path=_env_path)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Flag to skip Graph API sync (useful when waiting for admin consent)
SKIP_GRAPH_API = os.getenv('SKIP_GRAPH_API', 'False').lower() == 'true'


def sync_all():
    """Sync all configured calendars."""
    logger.info("=" * 80)
    logger.info("Starting sync of all calendars")
    logger.info("=" * 80)
    logger.info("")
    
    sync_operations = []
    
    # 1. Microsoft Graph API sync
    if not SKIP_GRAPH_API:
        sync_operations.append(('Work Outlook Calendar (Microsoft Graph API)', lambda: CalendarSync().sync()))
    else:
        logger.info("SYNC 1/2: Work Outlook Calendar (Microsoft Graph API) - SKIPPED")
        logger.info("-" * 80)
        logger.info("⚠ Graph API sync temporarily disabled (waiting for admin approval)")
        logger.info("   To re-enable: Set SKIP_GRAPH_API = False in sync_all_calendars.py")
        logger.info("")
    
    # 2. Outlook ICS Feed sync
    sync_operations.append(('Work Outlook Calendar (ICS Feed)', lambda: CalendarSyncICS().sync()))
    
    # 3. Apple Calendar sync
    sync_operations.append(('Personal iCloud Calendars', lambda: AppleCalendarSync().sync()))
    
    completed = 0
    skipped = 0
    failed = []
    
    for i, (name, sync_func) in enumerate(sync_operations, 1):
        if name.endswith('SKIPPED'):
            skipped += 1
            continue
            
        logger.info("SYNC {}/{}: {}".format(i, len(sync_operations), name))
        logger.info("-" * 80)
        
        try:
            sync_func()
            logger.info("✓ {} sync completed".format(name))
            completed += 1
        except Exception as e:
            logger.error("✗ {} sync failed: {}".format(name, e))
            failed.append((name, str(e)))
        
        logger.info("")
    
    # Summary
    logger.info("=" * 80)
    logger.info("SYNC SUMMARY")
    logger.info("=" * 80)
    logger.info("Completed: {}/{} active sync operations".format(completed, len(sync_operations) - skipped))
    if skipped > 0:
        logger.info("Skipped: {} sync operation(s)".format(skipped))
        logger.info("⊘ Work Outlook Calendar (Graph API) - skipped (waiting for admin approval)")
    
    if failed:
        for name, error in failed:
            logger.info("✗ {}: {}".format(name, error))
    
    logger.info("=" * 80)


if __name__ == '__main__':
    sync_all()
