import { Component, Input, Output, EventEmitter, ViewChild, ElementRef, signal, inject, OnDestroy, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';
import { Typography } from '../../ui-components/typography/typography';
import { Button } from '../../ui-components/button/button';
import { Input as InputComponent } from '../../ui-components/input/input';
import { Svg } from '../../ui-components/svg/svg';
import { ModalComponent } from '../modal/modal.component';
import { TypographyTypeEnum } from '../../constants/typography';
import { ButtonSizeEnum, ButtonStyleEnum } from '../../constants/button';
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
  imports: [CommonModule, FormsModule, Typography, Button, InputComponent, Svg, ModalComponent],
  templateUrl: './message-list.html',
  styleUrl: './message-list.scss',
})
export class MessageList implements OnChanges, OnDestroy {
  @Input() messages: Message[] = [];
  @Input() isConnected = false;
  @Input() currentUserId: number | null = null;
  @Output() sendMessage = new EventEmitter<SendMessageData>();
  @Output() editMessage = new EventEmitter<EditMessageData>();
  @Output() deleteMessage = new EventEmitter<DeleteMessageData>();

  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;

  editingMessageId: number | null = null;
  editContent = '';
  isEditing = false;

  private destroy$ = new Subject<void>();
  private consultationService = inject(ConsultationService);
  private imageUrlCache = new Map<number, string>();

  viewingImage = signal<{ url: string; fileName: string } | null>(null);
  imageUrls = signal<Map<number, string>>(new Map());

  newMessage = '';
  selectedFile: File | null = null;

  protected readonly TypographyTypeEnum = TypographyTypeEnum;
  protected readonly ButtonSizeEnum = ButtonSizeEnum;
  protected readonly ButtonStyleEnum = ButtonStyleEnum;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['messages']) {
      this.loadImageAttachments();
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.imageUrlCache.forEach(url => URL.revokeObjectURL(url));
    this.imageUrlCache.clear();
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
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  isImageAttachment(attachment: MessageAttachment): boolean {
    return attachment.mime_type.startsWith('image/');
  }

  getAttachmentIcon(attachment: MessageAttachment): string {
    if (attachment.mime_type.startsWith('image/')) return 'image';
    if (attachment.mime_type === 'application/pdf') return 'file-text';
    if (attachment.mime_type.includes('word') || attachment.mime_type.includes('document')) return 'file-text';
    if (attachment.mime_type.includes('spreadsheet') || attachment.mime_type.includes('excel')) return 'file-text';
    return 'paperclip';
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
