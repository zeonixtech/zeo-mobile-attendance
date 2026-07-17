import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { MenuController, ViewWillEnter } from '@ionic/angular';

export interface HistoryEntry {
  type: 'check-in' | 'check-out' | 'leave';
  timestamp: string;
  latitude?: number;
  longitude?: number;
  mode?: string;
}

export interface DateGroupedAttendance {
  displayDate: string; // e.g. "Monday, July 01, 2026"
  dayNumber: string; // e.g. "01"
  monthShort: string; // e.g. "Jul"
  dayShort: string; // e.g. "Mon"
  checkIn?: HistoryEntry;
  checkOut?: HistoryEntry;
  isToday?: boolean;
  isLeave?: boolean;
  leaveEntry?: HistoryEntry;
}

@Component({
  selector: 'app-attendance',
  templateUrl: './attendance.page.html',
  styleUrls: ['./attendance.page.scss'],
  standalone: false,
})
export class AttendancePage implements OnInit, ViewWillEnter {
  groupedRecords: DateGroupedAttendance[] = [];
  allHistoryEntries: HistoryEntry[] = [];

  pageSize: number = 10;
  displayedCount: number = 10;
  allGroupedRecords: DateGroupedAttendance[] = [];
  infiniteScrollDisabled: boolean = false;

  filterType: 'weekly' | 'monthly' | 'yearly' | 'custom' = 'weekly';
  filterMonth: number = new Date().getMonth();
  filterYear: number = new Date().getFullYear();
  filterStartDate: string = '';
  filterEndDate: string = '';

  months: string[] = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  availableYears: number[] = [];

  constructor(
    private router: Router,
    private menuController: MenuController
  ) { }

  async ionViewWillEnter() {
    await this.menuController.enable(true, 'attendance-content-menu');
    await this.menuController.enable(false, 'home-content-menu');
    await this.menuController.close('attendance-content-menu');
  }

  ngOnInit() {
    this.loadHistory();
  }

  loadHistory() {
    let history: HistoryEntry[] = [];
    const stored = localStorage.getItem('attendance_history');
    const hasRichMock = localStorage.getItem('attendance_history_rich_leave');

    if (stored && hasRichMock) {
      history = JSON.parse(stored);
      // Sort first to ensure history[0] is the latest entry
      history.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      this.fillGapInHistory(history);
    } else {
      // Prepopulate with mock data if history is empty or old
      history = this.generateMockHistory();
      localStorage.setItem('attendance_history', JSON.stringify(history));
      localStorage.setItem('attendance_history_rich_leave', 'true');
    }

    // Sort by timestamp descending
    history.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    this.allHistoryEntries = history;

    // Dynamically calculate years present in data
    const years = history.map(entry => new Date(entry.timestamp).getFullYear());
    this.availableYears = Array.from(new Set(years)).sort((a, b) => b - a);

    // Fallback if availableYears is empty
    if (this.availableYears.length === 0) {
      this.availableYears = [new Date().getFullYear()];
    }

    this.applyFilters();
  }

  private fillGapInHistory(history: HistoryEntry[]) {
    if (history.length === 0) return;

    const latestDate = new Date(history[0].timestamp);
    if (isNaN(latestDate.getTime())) return;
    latestDate.setHours(0, 0, 0, 0);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (latestDate.getTime() < today.getTime()) {
      const diffTime = today.getTime() - latestDate.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      const newRecords: HistoryEntry[] = [];
      for (let i = 1; i <= diffDays; i++) {
        const date = new Date(latestDate);
        date.setDate(latestDate.getDate() + i);
        const day = date.getDay();
        if (day === 0 || day === 6) continue; // Skip weekends

        this.addMockRecordPair(newRecords, date);
      }

      if (newRecords.length > 0) {
        history.push(...newRecords);
        localStorage.setItem('attendance_history', JSON.stringify(history));
      }
    }
  }

  getCurrentWeekBounds() {
    const today = new Date();
    const day = today.getDay();
    const diff = today.getDate() - day + (day === 0 ? -6 : 1);
    const start = new Date(today.setDate(diff));
    start.setHours(0, 0, 0, 0);

    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);

    return { start, end };
  }

  applyFilters() {
    let filtered = [...this.allHistoryEntries];

    if (this.filterType === 'weekly') {
      const { start, end } = this.getCurrentWeekBounds();
      filtered = filtered.filter(entry => {
        const entryTime = new Date(entry.timestamp).getTime();
        return entryTime >= start.getTime() && entryTime <= end.getTime();
      });
    } else if (this.filterType === 'monthly') {
      filtered = filtered.filter(entry => {
        const date = new Date(entry.timestamp);
        return date.getMonth() === Number(this.filterMonth) && date.getFullYear() === Number(this.filterYear);
      });
    } else if (this.filterType === 'yearly') {
      filtered = filtered.filter(entry => {
        const date = new Date(entry.timestamp);
        return date.getFullYear() === Number(this.filterYear);
      });
    } else if (this.filterType === 'custom') {
      if (this.filterStartDate) {
        const start = new Date(this.filterStartDate);
        start.setHours(0, 0, 0, 0);
        filtered = filtered.filter(entry => new Date(entry.timestamp) >= start);
      }
      if (this.filterEndDate) {
        const end = new Date(this.filterEndDate);
        end.setHours(23, 59, 59, 999);
        filtered = filtered.filter(entry => new Date(entry.timestamp) <= end);
      }
    }

    this.groupRecords(filtered);
  }

  getFilteredRecordsCount(): number {
    let count = 0;
    this.groupedRecords.forEach(r => {
      if (r.checkIn) count++;
      if (r.checkOut) count++;
    });
    return count;
  }

  formatDateString(dateStr: string): string {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  resetFilters() {
    this.filterType = 'weekly';
    this.filterStartDate = '';
    this.filterEndDate = '';
    this.filterMonth = new Date().getMonth();
    this.filterYear = new Date().getFullYear();
    this.applyFilters();
  }

  groupRecords(history: HistoryEntry[]) {
    // Group by Date
    const groups: { [key: string]: DateGroupedAttendance } = {};

    const localToday = new Date();
    const year = localToday.getFullYear();
    const month = String(localToday.getMonth() + 1).padStart(2, '0');
    const day = String(localToday.getDate()).padStart(2, '0');
    const todayKey = `${year}-${month}-${day}`;

    history.forEach((entry) => {
      const dateObj = new Date(entry.timestamp);
      // Grouping key format: YYYY-MM-DD
      const entryYear = dateObj.getFullYear();
      const entryMonth = String(dateObj.getMonth() + 1).padStart(2, '0');
      const entryDay = String(dateObj.getDate()).padStart(2, '0');
      const key = `${entryYear}-${entryMonth}-${entryDay}`;

      if (!groups[key]) {
        const options: Intl.DateTimeFormatOptions = {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        };
        groups[key] = {
          displayDate: dateObj.toLocaleDateString('en-US', options),
          dayNumber: String(dateObj.getDate()).padStart(2, '0'),
          monthShort: dateObj.toLocaleDateString('en-US', { month: 'short' }),
          dayShort: dateObj.toLocaleDateString('en-US', { weekday: 'short' }),
          isToday: key === todayKey
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
      } else if (entry.type === 'leave') {
        groups[key].isLeave = true;
        groups[key].leaveEntry = entry;
      }
    });

    // Convert map to sorted array (most recent first)
    this.allGroupedRecords = Object.keys(groups)
      .sort((a, b) => b.localeCompare(a))
      .map(key => groups[key]);

    // Reset pagination to first page
    this.displayedCount = this.pageSize;
    this.groupedRecords = this.allGroupedRecords.slice(0, this.displayedCount);
    this.infiniteScrollDisabled = this.displayedCount >= this.allGroupedRecords.length;
  }

  loadMore(event: any) {
    setTimeout(() => {
      this.displayedCount += this.pageSize;
      this.groupedRecords = this.allGroupedRecords.slice(0, this.displayedCount);

      event.target.complete();

      if (this.displayedCount >= this.allGroupedRecords.length) {
        this.infiniteScrollDisabled = true;
      }
    }, 800);
  }

  private generateMockHistory(): HistoryEntry[] {
    const records: HistoryEntry[] = [];
    const baseDate = new Date();

    // 1. Daily for the last 7 days:
    for (let i = 0; i < 7; i++) {
      const date = new Date(baseDate);
      date.setDate(baseDate.getDate() - i);
      const day = date.getDay();
      if (day === 0 || day === 6) continue;

      if (i === 3) {
        records.push({
          type: 'leave',
          timestamp: date.toISOString(),
          mode: 'Sick Leave'
        });
      } else {
        this.addMockRecordPair(records, date);
      }
    }

    // 2. A few records per month for the last 18 months
    const start = new Date(baseDate);
    start.setMonth(baseDate.getMonth() - 18);

    let current = new Date(start);
    let mockLeaveCounter = 0;
    while (current < baseDate) {
      // Don't duplicate the current month since we already have daily entries
      if (current.getMonth() !== baseDate.getMonth() || current.getFullYear() !== baseDate.getFullYear()) {
        // Add 2 random working days in this month
        for (let j = 0; j < 2; j++) {
          const mockDate = new Date(current.getFullYear(), current.getMonth(), 10 + j * 7);
          const day = mockDate.getDay();
          if (day === 0 || day === 6) continue;

          // Occasionally add a Leave entry in past months
          if (j === 1 && mockLeaveCounter % 4 === 0) {
            records.push({
              type: 'leave',
              timestamp: mockDate.toISOString(),
              mode: mockLeaveCounter % 8 === 0 ? 'Casual Leave' : 'Privilege Leave'
            });
          } else {
            this.addMockRecordPair(records, mockDate);
          }
          mockLeaveCounter++;
        }
      }
      current.setMonth(current.getMonth() + 1);
    }

    return records;
  }

  private addMockRecordPair(records: HistoryEntry[], date: Date) {
    const day = date.getDay();
    if (day === 0 || day === 6) return; // Skip weekends

    // Check-in at 9:00 AM + random minutes
    const checkInTime = new Date(date);
    checkInTime.setHours(9, Math.floor(Math.random() * 30), 0);

    // Check-out at 6:00 PM + random minutes
    const checkOutTime = new Date(date);
    checkOutTime.setHours(18, Math.floor(Math.random() * 30), 0);

    const modes = ['Office', 'Field Duty', 'Remote Work'];
    const mode = modes[Math.floor(Math.random() * modes.length)];

    records.push({
      type: 'check-in',
      timestamp: checkInTime.toISOString(),
      latitude: 30.740416 + (Math.random() - 0.5) * 0.0001,
      longitude: 76.780692 + (Math.random() - 0.5) * 0.0001,
      mode: mode
    });

    records.push({
      type: 'check-out',
      timestamp: checkOutTime.toISOString(),
      latitude: 30.740416 + (Math.random() - 0.5) * 0.0001,
      longitude: 76.780692 + (Math.random() - 0.5) * 0.0001,
      mode: mode
    });
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
