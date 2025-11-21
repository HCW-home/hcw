import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Typography } from '../../ui-components/typography/typography';
import { Button } from '../../ui-components/button/button';
import { Input as InputComponent } from '../../ui-components/input/input';
import { TypographyTypeEnum } from '../../constants/typography';
import { ButtonSizeEnum, ButtonStyleEnum } from '../../constants/button';

export interface Message {
  id: number;
  username: string;
  message: string;
  timestamp: string;
  isCurrentUser: boolean;
}

@Component({
  selector: 'app-message-list',
  imports: [CommonModule, FormsModule, Typography, Button, InputComponent],
  templateUrl: './message-list.html',
  styleUrl: './message-list.scss',
})
export class MessageList {
  @Input() messages: Message[] = [];
  @Input() isConnected = false;
  @Output() sendMessage = new EventEmitter<string>();

  newMessage = '';

  protected readonly TypographyTypeEnum = TypographyTypeEnum;
  protected readonly ButtonSizeEnum = ButtonSizeEnum;
  protected readonly ButtonStyleEnum = ButtonStyleEnum;

  onSendMessage(): void {
    if (this.newMessage.trim() && this.isConnected) {
      this.sendMessage.emit(this.newMessage.trim());
      this.newMessage = '';
    }
  }

  formatTime(timestamp: string): string {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
}
