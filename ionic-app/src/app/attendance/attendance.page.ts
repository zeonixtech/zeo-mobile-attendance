import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { MenuController, ViewWillEnter } from '@ionic/angular';
import { SharedApi } from '../services/shared-api';

export interface HistoryEntry {
  type: 'check-in' | 'check-out' | 'leave' | 'holiday';
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
  isHoliday?: boolean;
  holidayEntry?: HistoryEntry;
  allLogs?: HistoryEntry[];
  hasMultiple?: boolean;
  showDetails?: boolean;
}

@Component({
  selector: 'app-attendance',
  templateUrl: './attendance.page.html',
  styleUrls: ['./attendance.page.scss'],
  standalone: false,
})
export class AttendancePage implements ViewWillEnter {
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
    private menuController: MenuController,
    private sharedApiService: SharedApi
  ) { }

  async ionViewWillEnter() {
    await this.menuController.enable(true, 'attendance-content-menu');
    await this.menuController.enable(false, 'home-content-menu');
    await this.menuController.close('attendance-content-menu');

    // AttendancePage is a reused component instance across Ionic navigation, so
    // ngOnInit() alone would only ever fetch once per app session — re-fetch on
    // every entry so server-side changes (new holidays, check-ins from elsewhere)
    // show up without a full app restart.
    await this.loadHistory();
  }

  async loadHistory() {
    const history = await this.sharedApiService.fetchAttendanceHistory();

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
      if (r.isLeave) {
        count++;
      } else if (r.isHoliday) {
        count++;
      } else if (r.allLogs) {
        count += r.allLogs.length;
      }
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
          isToday: key === todayKey,
          allLogs: [],
          hasMultiple: false,
          showDetails: false
        };
      }

      if (entry.type === 'check-in' || entry.type === 'check-out') {
        groups[key].allLogs!.push(entry);
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
      } else if (entry.type === 'holiday') {
        groups[key].isHoliday = true;
        groups[key].holidayEntry = entry;
      }
    });

    // Post-process to sort allLogs and set hasMultiple
    Object.keys(groups).forEach(key => {
      const g = groups[key];
      if (g.allLogs) {
        g.allLogs.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
        const checkIns = g.allLogs.filter(e => e.type === 'check-in');
        const checkOuts = g.allLogs.filter(e => e.type === 'check-out');
        g.hasMultiple = checkIns.length > 1 || checkOuts.length > 1;
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
