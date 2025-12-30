import {
  Component,
  Input,
  Output,
  EventEmitter,
  ViewChild,
  ElementRef,
  signal,
  OnDestroy,
  OnChanges,
  SimpleChanges,
  AfterViewChecked
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  IonIcon,
  IonButton,
  IonSpinner
} from '@ionic/angular/standalone';
import { Subject, takeUntil } from 'rxjs';
import { ConsultationService } from '../../../core/services/consultation.service';

export interface MessageAttachment {
  file_name: string;
  mime_type: string;
}

export interface Message {
  id: number;
  username: string;
  message: string;
  timestamp: string;
  isCurrentUser: boolean;
  attachment?: MessageAttachment | null;
  isEdited?: boolean;
  updatedAt?: string;
  deletedAt?: string | null;
}

export interface SendMessageData {
  content?: string;
  attachment?: File;
}

export interface EditMessageData {
  messageId: number;
  content: string;
}

export interface DeleteMessageData {
  messageId: number;
}

@Component({
  selector: 'app-message-list',
  templateUrl: './message-list.html',
  styleUrls: ['./message-list.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonIcon,
    IonButton,
    IonSpinner
  ]
})
export class MessageListComponent implements OnChanges, OnDestroy, AfterViewChecked {
  @Input() messages: Message[] = [];
  @Input() isConnected = false;
  @Output() sendMessage = new EventEmitter<SendMessageData>();
  @Output() editMessage = new EventEmitter<EditMessageData>();
  @Output() deleteMessage = new EventEmitter<DeleteMessageData>();

  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;
  @ViewChild('messagesContainer') messagesContainer!: ElementRef<HTMLDivElement>;

  editingMessageId: number | null = null;
  editContent = '';
  isEditing = false;

  private destroy$ = new Subject<void>();
  private imageUrlCache = new Map<number, string>();
  private shouldScrollToBottom = false;

  viewingImage = signal<{ url: string; fileName: string } | null>(null);
  imageUrls = signal<Map<number, string>>(new Map());

  newMessage = '';
  selectedFile: File | null = null;

  constructor(private consultationService: ConsultationService) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['messages']) {
      this.loadImageAttachments();
      this.shouldScrollToBottom = true;
    }
  }

  ngAfterViewChecked(): void {
    if (this.shouldScrollToBottom) {
      this.scrollToBottom();
      this.shouldScrollToBottom = false;
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.imageUrlCache.forEach(url => URL.revokeObjectURL(url));
    this.imageUrlCache.clear();
  }

  private scrollToBottom(): void {
    if (this.messagesContainer?.nativeElement) {
      const container = this.messagesContainer.nativeElement;
      container.scrollTop = container.scrollHeight;
    }
  }

  private loadImageAttachments(): void {
    this.messages.forEach(message => {
      const isTempId = message.id > 1000000000000;
      if (message.attachment && this.isImageAttachment(message.attachment) && !this.imageUrlCache.has(message.id) && !isTempId) {
        this.consultationService.getMessageAttachment(message.id)
          .pipe(takeUntil(this.destroy$))
          .subscribe({
            next: (blob) => {
              const url = URL.createObjectURL(blob);
              this.imageUrlCache.set(message.id, url);
              this.imageUrls.set(new Map(this.imageUrlCache));
            }
          });
      }
    });
  }

  getImageUrl(messageId: number): string | undefined {
    return this.imageUrls().get(messageId);
  }

  onSendMessage(): void {
    if ((this.newMessage.trim() || this.selectedFile) && this.isConnected) {
      this.sendMessage.emit({
        content: this.newMessage.trim() || undefined,
        attachment: this.selectedFile || undefined
      });
      this.newMessage = '';
      this.selectedFile = null;
    }
  }

  openFilePicker(): void {
    this.fileInput.nativeElement.click();
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.selectedFile = input.files[0];
    }
  }

  removeSelectedFile(): void {
    this.selectedFile = null;
    if (this.fileInput) {
      this.fileInput.nativeElement.value = '';
    }
  }

  formatTime(timestamp: string): string {
    const date = new Date(timestamp);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (diffDays === 1) {
      return 'Yesterday';
    } else if (diffDays < 7) {
      return date.toLocaleDateString([], { weekday: 'short' });
    } else {
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
  }

  isImageAttachment(attachment: MessageAttachment): boolean {
    return attachment.mime_type.startsWith('image/');
  }

  getAttachmentIcon(attachment: MessageAttachment): string {
    if (attachment.mime_type.startsWith('image/')) return 'image-outline';
    if (attachment.mime_type === 'application/pdf') return 'document-text-outline';
    if (attachment.mime_type.includes('word') || attachment.mime_type.includes('document')) return 'document-text-outline';
    if (attachment.mime_type.includes('spreadsheet') || attachment.mime_type.includes('excel')) return 'document-text-outline';
    return 'attach-outline';
  }

  openImageViewer(message: Message): void {
    const url = this.getImageUrl(message.id);
    if (message.attachment && this.isImageAttachment(message.attachment) && url) {
      this.viewingImage.set({
        url,
        fileName: message.attachment.file_name
      });
    }
  }

  closeImageViewer(): void {
    this.viewingImage.set(null);
  }

  canEditMessage(message: Message): boolean {
    return message.isCurrentUser && !message.deletedAt;
  }

  canDeleteMessage(message: Message): boolean {
    return message.isCurrentUser && !message.deletedAt;
  }

  isMessageDeleted(message: Message): boolean {
    return !!message.deletedAt;
  }

  onDeleteClick(message: Message): void {
    this.deleteMessage.emit({ messageId: message.id });
  }

  startEdit(message: Message): void {
    this.editingMessageId = message.id;
    this.editContent = message.message;
  }

  cancelEdit(): void {
    this.editingMessageId = null;
    this.editContent = '';
  }

  saveEdit(): void {
    if (!this.editingMessageId || !this.editContent.trim()) {
      return;
    }

    this.editMessage.emit({
      messageId: this.editingMessageId,
      content: this.editContent.trim()
    });
    this.onEditComplete();
  }

  onEditComplete(): void {
    this.editingMessageId = null;
    this.editContent = '';
    this.isEditing = false;
  }
}
