import { Component, Input, Output, EventEmitter, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Typography } from '../../ui-components/typography/typography';
import { Button } from '../../ui-components/button/button';
import { Input as InputComponent } from '../../ui-components/input/input';
import { Svg } from '../../ui-components/svg/svg';
import { TypographyTypeEnum } from '../../constants/typography';
import { ButtonSizeEnum, ButtonStyleEnum } from '../../constants/button';

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
}

export interface SendMessageData {
  content?: string;
  attachment?: File;
}

@Component({
  selector: 'app-message-list',
  imports: [CommonModule, FormsModule, Typography, Button, InputComponent, Svg],
  templateUrl: './message-list.html',
  styleUrl: './message-list.scss',
})
export class MessageList {
  @Input() messages: Message[] = [];
  @Input() isConnected = false;
  @Output() sendMessage = new EventEmitter<SendMessageData>();

  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;

  newMessage = '';
  selectedFile: File | null = null;

  protected readonly TypographyTypeEnum = TypographyTypeEnum;
  protected readonly ButtonSizeEnum = ButtonSizeEnum;
  protected readonly ButtonStyleEnum = ButtonStyleEnum;

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
}
