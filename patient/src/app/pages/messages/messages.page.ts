import { Component, OnInit, OnDestroy, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonList,
  IonItem,
  IonLabel,
  IonAvatar,
  IonBadge,
  IonIcon,
  IonSearchbar,
  IonRefresher,
  IonRefresherContent,
  IonSpinner,
  IonText,
  IonFooter,
  IonInput,
  IonButton,
  IonButtons,
  IonBackButton,
  NavController,
  IonNote
} from '@ionic/angular/standalone';
import { Subscription } from 'rxjs';
import { ConsultationService } from '../../core/services/consultation.service';
import { ConsultationWebSocketService } from '../../core/services/consultation-websocket.service';
import { AuthService } from '../../core/services/auth.service';
import { Consultation, ConsultationMessage } from '../../core/models/consultation.model';
import { User } from '../../core/models/user.model';
import { WebSocketState } from '../../core/models/websocket.model';

interface ConversationThread {
  consultation: Consultation;
  lastMessage?: ConsultationMessage;
  unreadCount: number;
}

@Component({
  selector: 'app-messages',
  templateUrl: './messages.page.html',
  styleUrls: ['./messages.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    IonList,
    IonItem,
    IonLabel,
    IonAvatar,
    IonBadge,
    IonIcon,
    IonSearchbar,
    IonRefresher,
    IonRefresherContent,
    IonSpinner,
    IonText,
    IonFooter,
    IonInput,
    IonButton,
    IonButtons,
    IonBackButton,
    IonNote
  ]
})
export class MessagesPage implements OnInit, OnDestroy {
  @ViewChild('messageContent') messageContent!: ElementRef;

  conversations: ConversationThread[] = [];
  filteredConversations: ConversationThread[] = [];
  selectedConsultation: Consultation | null = null;
  messages: ConsultationMessage[] = [];
  newMessage = '';
  currentUser: User | null = null;
  isLoading = true;
  isLoadingMessages = false;
  isSending = false;
  searchTerm = '';
  connectionState: WebSocketState = WebSocketState.DISCONNECTED;

  private subscriptions: Subscription[] = [];

  constructor(
    private consultationService: ConsultationService,
    private consultationWs: ConsultationWebSocketService,
    private authService: AuthService,
    private navCtrl: NavController
  ) {}

  ngOnInit() {
    this.loadCurrentUser();
    this.loadConversations();
    this.setupWebSocketListeners();
  }

  ngOnDestroy() {
    this.subscriptions.forEach(sub => sub.unsubscribe());
    if (this.selectedConsultation) {
      this.consultationWs.disconnect();
    }
  }

  private loadCurrentUser(): void {
    const userSub = this.authService.currentUser$.subscribe(user => {
      this.currentUser = user;
    });
    this.subscriptions.push(userSub);
  }

  loadConversations(event?: { target: { complete: () => void } }): void {
    this.isLoading = !event;
    this.consultationService.getMyConsultations({ status: 'ACTIVE' }).subscribe({
      next: (response) => {
        this.conversations = response.results.map(consultation => ({
          consultation,
          lastMessage: consultation.messages?.[consultation.messages.length - 1],
          unreadCount: 0
        }));
        this.applySearch();
        this.isLoading = false;
        event?.target.complete();
      },
      error: () => {
        this.isLoading = false;
        event?.target.complete();
      }
    });
  }

  private setupWebSocketListeners(): void {
    const stateSub = this.consultationWs.state$.subscribe(state => {
      this.connectionState = state;
    });

    const msgSub = this.consultationWs.messages$.subscribe(message => {
      if (this.selectedConsultation && message.consultation_id === this.selectedConsultation.id) {
        this.messages.push({
          id: message.id,
          consultation: message.consultation_id,
          created_by: {
            id: message.user_id,
            username: message.username,
            email: '',
            first_name: message.username.split(' ')[0] || message.username,
            last_name: message.username.split(' ')[1] || ''
          },
          created_at: message.timestamp,
          content: message.message
        });
        this.scrollToBottom();
      }
    });

    this.subscriptions.push(stateSub, msgSub);
  }

  searchConversations(event: CustomEvent): void {
    this.searchTerm = (event.detail.value || '').toLowerCase();
    this.applySearch();
  }

  private applySearch(): void {
    if (!this.searchTerm) {
      this.filteredConversations = [...this.conversations];
      return;
    }

    this.filteredConversations = this.conversations.filter(thread => {
      const consultation = thread.consultation;
      const ownerName = consultation.owned_by
        ? `${consultation.owned_by.first_name} ${consultation.owned_by.last_name}`.toLowerCase()
        : '';
      const title = (consultation.title || '').toLowerCase();
      return ownerName.includes(this.searchTerm) || title.includes(this.searchTerm);
    });
  }

  selectConversation(thread: ConversationThread): void {
    this.selectedConsultation = thread.consultation;
    this.loadMessages(thread.consultation.id);
    this.consultationWs.connect(thread.consultation.id);
  }

  backToList(): void {
    if (this.selectedConsultation) {
      this.consultationWs.disconnect();
    }
    this.selectedConsultation = null;
    this.messages = [];
  }

  private loadMessages(consultationId: number): void {
    this.isLoadingMessages = true;
    this.consultationService.getConsultationMessages(consultationId).subscribe({
      next: (messages) => {
        this.messages = messages;
        this.isLoadingMessages = false;
        setTimeout(() => this.scrollToBottom(), 100);
      },
      error: () => {
        this.isLoadingMessages = false;
      }
    });
  }

  sendMessage(): void {
    if (!this.newMessage.trim() || !this.selectedConsultation || this.isSending) {
      return;
    }

    const content = this.newMessage.trim();
    this.isSending = true;

    if (this.consultationWs.isConnected) {
      this.consultationWs.sendMessage(content);
      this.newMessage = '';
      this.isSending = false;
    } else {
      this.consultationService.sendConsultationMessage(this.selectedConsultation.id, content).subscribe({
        next: (message) => {
          this.messages.push(message);
          this.newMessage = '';
          this.isSending = false;
          this.scrollToBottom();
        },
        error: () => {
          this.isSending = false;
        }
      });
    }
  }

  private scrollToBottom(): void {
    if (this.messageContent?.nativeElement) {
      const content = this.messageContent.nativeElement;
      content.scrollToBottom(300);
    }
  }

  isOwnMessage(message: ConsultationMessage): boolean {
    return this.currentUser?.id === message.created_by.id;
  }

  getParticipantName(consultation: Consultation): string {
    if (consultation.owned_by) {
      return `${consultation.owned_by.first_name} ${consultation.owned_by.last_name}`;
    }
    return consultation.title || 'Unknown';
  }

  getParticipantInitial(consultation: Consultation): string {
    if (consultation.owned_by?.first_name) {
      return consultation.owned_by.first_name.charAt(0).toUpperCase();
    }
    return '?';
  }

  formatTime(dateString: string): string {
    const date = new Date(dateString);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (days === 1) {
      return 'Yesterday';
    } else if (days < 7) {
      return date.toLocaleDateString([], { weekday: 'short' });
    } else {
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
  }

  refreshConversations(event: { target: { complete: () => void } }): void {
    this.loadConversations(event);
  }

  get isConnected(): boolean {
    return this.connectionState === WebSocketState.CONNECTED;
  }

  get isReconnecting(): boolean {
    return this.connectionState === WebSocketState.RECONNECTING;
  }
}
