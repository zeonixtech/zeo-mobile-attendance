import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';

export interface HistoryEntry {
  type: 'check-in' | 'check-out';
  timestamp: string;
  latitude: number;
  longitude: number;
  mode?: string;
}

export interface DateGroupedAttendance {
  displayDate: string; // e.g. "Monday, July 01, 2026"
  checkIn?: HistoryEntry;
  checkOut?: HistoryEntry;
}

@Component({
  selector: 'app-attendance',
  templateUrl: './attendance.page.html',
  styleUrls: ['./attendance.page.scss'],
  standalone: false,
})
export class AttendancePage implements OnInit {
  groupedRecords: DateGroupedAttendance[] = [];

  constructor(private router: Router) {}

  ngOnInit() {
    this.loadHistory();
  }

  loadHistory() {
    let history: HistoryEntry[] = [];
    const stored = localStorage.getItem('attendance_history');
    
    if (stored) {
      history = JSON.parse(stored);
    } else {
      // Prepopulate with mock data if history is empty
      history = this.generateMockHistory();
      localStorage.setItem('attendance_history', JSON.stringify(history));
    }

    // Sort by timestamp descending
    history.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    // Group by Date
    const groups: { [key: string]: DateGroupedAttendance } = {};

    history.forEach((entry) => {
      const dateObj = new Date(entry.timestamp);
      // Grouping key format: YYYY-MM-DD
      const key = dateObj.toISOString().split('T')[0];
      
      if (!groups[key]) {
        const options: Intl.DateTimeFormatOptions = { 
          weekday: 'long', 
          year: 'numeric', 
          month: 'long', 
          day: 'numeric' 
        };
        groups[key] = {
          displayDate: dateObj.toLocaleDateString('en-US', options)
        };
      }

      if (entry.type === 'check-in') {
        // Keep the earliest check-in for the day
        if (!groups[key].checkIn || new Date(entry.timestamp).getTime() < new Date(groups[key].checkIn!.timestamp).getTime()) {
          groups[key].checkIn = entry;
        }
      } else if (entry.type === 'check-out') {
        // Keep the latest check-out for the day
        if (!groups[key].checkOut || new Date(entry.timestamp).getTime() > new Date(groups[key].checkOut!.timestamp).getTime()) {
          groups[key].checkOut = entry;
        }
      }
    });

    // Convert map to sorted array (most recent first)
    this.groupedRecords = Object.keys(groups)
      .sort((a, b) => b.localeCompare(a))
      .map(key => groups[key]);
  }

  private generateMockHistory(): HistoryEntry[] {
    const records: HistoryEntry[] = [];
    const baseDate = new Date();
    
    // Create checkin/checkout for the past 3 days
    for (let i = 1; i <= 3; i++) {
      const date = new Date();
      date.setDate(baseDate.getDate() - i);
      
      // Check in at 9:00 AM + random minutes
      const checkInTime = new Date(date);
      checkInTime.setHours(9, Math.floor(Math.random() * 30), 0);

      // Check out at 6:00 PM + random minutes
      const checkOutTime = new Date(date);
      checkOutTime.setHours(18, Math.floor(Math.random() * 30), 0);

      records.push({
        type: 'check-in',
        timestamp: checkInTime.toISOString(),
        latitude: 30.740416 + (Math.random() - 0.5) * 0.0001,
        longitude: 76.780692 + (Math.random() - 0.5) * 0.0001,
        mode: 'Office'
      });

      records.push({
        type: 'check-out',
        timestamp: checkOutTime.toISOString(),
        latitude: 30.740416 + (Math.random() - 0.5) * 0.0001,
        longitude: 76.780692 + (Math.random() - 0.5) * 0.0001,
        mode: 'Office'
      });
    }

    return records;
  }

  goToHome() {
    this.router.navigate(['/home']);
  }

  goToHistory() {
    // Already on History
  }

  formatTime(isoString: string): string {
    return new Date(isoString).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });
  }
}
