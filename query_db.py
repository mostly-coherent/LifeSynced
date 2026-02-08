#!/usr/bin/env python3
"""
Query Outlook Calendar Database

Simple utility to query and display appointments from the database.
"""

import sqlite3
import json
import sys
from datetime import datetime, timedelta
from pathlib import Path
from dotenv import load_dotenv
import os

# Single env file at repo root (LifeSynced/.env.local)
_env_path = Path(__file__).resolve().parent / ".env.local"
load_dotenv(dotenv_path=_env_path)
DB_PATH = os.getenv('DB_PATH', 'calendar.db')


def format_datetime(dt_str: str) -> str:
    """Format ISO datetime string for display."""
    try:
        dt = datetime.fromisoformat(dt_str.replace('Z', '+00:00'))
        return dt.strftime('%Y-%m-%d %H:%M')
    except (ValueError, AttributeError):
        return dt_str


def list_appointments(limit: int = 20, days_ahead: int = 30):
    """List upcoming appointments."""
    # Use UTC-aware datetime for proper comparison
    from datetime import timezone as tz
    now = datetime.now(tz.utc)
    end_date = now + timedelta(days=days_ahead)
    
    # Convert to ISO strings for SQL comparison
    now_str = now.isoformat()
    end_date_str = end_date.isoformat()
    
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT * FROM appointments 
            WHERE start_time >= ? AND start_time <= ?
            ORDER BY start_time ASC
            LIMIT ?
        ''', (now_str, end_date_str, limit))
        
        rows = cursor.fetchall()
        
        if not rows:
            print("No upcoming appointments found.")
            return
        
        print(f"\nUpcoming appointments (next {days_ahead} days):\n")
        for row in rows:
            print(f"Subject: {row['subject']}")
            print(f"Start: {format_datetime(row['start_time'])}")
            print(f"End: {format_datetime(row['end_time'])}")
            if row['location']:
                print(f"Location: {row['location']}")
            print(f"Source: {row.get('source', 'unknown')}")
            print("-" * 50)


def show_stats():
    """Show database statistics."""
    with sqlite3.connect(DB_PATH) as conn:
        cursor = conn.cursor()
        
        cursor.execute('SELECT COUNT(*) FROM appointments')
        total = cursor.fetchone()[0]
        
        cursor.execute('SELECT COUNT(*) FROM appointments WHERE source = ?', ('graph_api',))
        graph_count = cursor.fetchone()[0]
        
        cursor.execute('SELECT COUNT(*) FROM appointments WHERE source = ?', ('ics',))
        ics_count = cursor.fetchone()[0]
        
        cursor.execute('SELECT COUNT(*) FROM appointments WHERE source = ?', ('apple_calendar',))
        apple_count = cursor.fetchone()[0]
        
        print(f"\nDatabase Statistics:\n")
        print(f"Total appointments: {total}")
        print(f"  - Graph API: {graph_count}")
        print(f"  - ICS Feed: {ics_count}")
        print(f"  - Apple Calendar: {apple_count}")


if __name__ == '__main__':
    if len(sys.argv) < 2:
        list_appointments()
    elif sys.argv[1] == 'list':
        limit = int(sys.argv[2]) if len(sys.argv) > 2 else 20
        days = int(sys.argv[3]) if len(sys.argv) > 3 else 30
        list_appointments(limit, days)
    elif sys.argv[1] == 'stats':
        show_stats()
    else:
        print("Usage: python3 query_db.py [list [limit] [days]] [stats]")

