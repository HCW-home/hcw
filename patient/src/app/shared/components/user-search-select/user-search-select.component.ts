import { Component, EventEmitter, Input, OnInit, OnDestroy, Output, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  IonSearchbar,
  IonList,
  IonItem,
  IonLabel,
  IonAvatar,
  IonText,
  IonSpinner,
  IonInfiniteScroll,
  IonInfiniteScrollContent,
  IonIcon,
  IonChip
} from '@ionic/angular/standalone';
import { Subject } from 'rxjs';
import { debounceTime, takeUntil } from 'rxjs/operators';
import { UserService } from '../../../core/services/user.service';
import { User } from '../../../core/models/user.model';

@Component({
  selector: 'app-user-search-select',
  templateUrl: './user-search-select.component.html',
  styleUrls: ['./user-search-select.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonSearchbar,
    IonList,
    IonItem,
    IonLabel,
    IonAvatar,
    IonText,
    IonSpinner,
    IonInfiniteScroll,
    IonInfiniteScrollContent,
    IonIcon,
    IonChip
  ]
})
export class UserSearchSelectComponent implements OnInit, OnDestroy {
  @Input() label = 'Select Beneficiary';
  @Input() placeholder = 'Search by name or email...';
  @Input() selectedUser: User | null = null;
  @Output() userSelected = new EventEmitter<User | null>();

  @ViewChild(IonInfiniteScroll) infiniteScroll!: IonInfiniteScroll;

  searchQuery = '';
  users: User[] = [];
  isLoading = false;
  isLoadingMore = false;
  hasMore = true;
  currentPage = 1;
  pageSize = 20;

  private searchSubject = new Subject<string>();
  private destroy$ = new Subject<void>();

  constructor(private userService: UserService) {}

  ngOnInit(): void {
    this.searchSubject
      .pipe(
        debounceTime(300),
        takeUntil(this.destroy$)
      )
      .subscribe(query => {
        this.performSearch(query);
      });

    this.loadUsers();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  onSearchChange(event: CustomEvent): void {
    const query = event.detail.value || '';
    this.searchQuery = query;
    this.searchSubject.next(query);
  }

  private performSearch(query: string): void {
    this.currentPage = 1;
    this.users = [];
    this.hasMore = true;
    this.loadUsers(query);
  }

  loadUsers(search?: string): void {
    if (this.isLoading) return;

    this.isLoading = true;
    const params = {
      search: search || this.searchQuery || undefined,
      page: this.currentPage,
      page_size: this.pageSize
    };

    this.userService.searchUsers(params)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          if (this.currentPage === 1) {
            this.users = response.results;
          } else {
            this.users = [...this.users, ...response.results];
          }
          this.hasMore = response.next !== null;
          this.isLoading = false;
          this.isLoadingMore = false;

          if (this.infiniteScroll) {
            this.infiniteScroll.complete();
            if (!this.hasMore) {
              this.infiniteScroll.disabled = true;
            }
          }
        },
        error: () => {
          this.isLoading = false;
          this.isLoadingMore = false;
          if (this.infiniteScroll) {
            this.infiniteScroll.complete();
          }
        }
      });
  }

  loadMore(event: CustomEvent): void {
    if (!this.hasMore || this.isLoadingMore) {
      (event.target as HTMLIonInfiniteScrollElement).complete();
      return;
    }

    this.isLoadingMore = true;
    this.currentPage++;
    this.loadUsers();
  }

  selectUser(user: User): void {
    this.selectedUser = user;
    this.userSelected.emit(user);
  }

  clearSelection(): void {
    this.selectedUser = null;
    this.userSelected.emit(null);
  }

  getUserDisplayName(user: User): string {
    const name = `${user.first_name || ''} ${user.last_name || ''}`.trim();
    return name || user.email || user.username;
  }

  getUserInitials(user: User): string {
    const firstName = user.first_name || '';
    const lastName = user.last_name || '';
    if (firstName && lastName) {
      return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
    }
    return (firstName || lastName || user.email || 'U').charAt(0).toUpperCase();
  }
}
