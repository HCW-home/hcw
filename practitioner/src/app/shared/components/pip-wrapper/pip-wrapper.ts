import {
  Component,
  HostListener,
  inject,
  signal,
  effect,
  DestroyRef,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { ActiveCallService } from '../../../core/services/active-call.service';
import { ConsultationService } from '../../../core/services/consultation.service';
import { ConsultationWebSocketService } from '../../../core/services/consultation-websocket.service';
import { IncomingCallService } from '../../../core/services/incoming-call.service';
import { ToasterService } from '../../../core/services/toaster.service';
import { TranslationService } from '../../../core/services/translation.service';
import { UserService } from '../../../core/services/user.service';
import { VideoConsultationComponent } from '../../../modules/user/components/video-consultation/video-consultation';
import {
  Message,
  SendMessageData,
  EditMessageData,
  DeleteMessageData,
} from '../message-list/message-list';
import { ConsultationMessage } from '../../../core/models/consultation';
import { IUser } from '../../../modules/user/models/user';
import { getErrorMessage } from '../../../core/utils/error-helper';

type InteractionMode = 'none' | 'drag' | 'resize';
type ResizeCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

@Component({
  selector: 'app-pip-wrapper',
  standalone: true,
  imports: [CommonModule, VideoConsultationComponent],
  templateUrl: './pip-wrapper.html',
  styleUrl: './pip-wrapper.scss',
})
export class PipWrapper {
  activeCallService = inject(ActiveCallService);
  private consultationService = inject(ConsultationService);
  private incomingCallService = inject(IncomingCallService);
  private wsService = inject(ConsultationWebSocketService);
  private userService = inject(UserService);
  private toasterService = inject(ToasterService);
  private t = inject(TranslationService);
  private destroyRef = inject(DestroyRef);

  private mode: InteractionMode = 'none';
  private startClientX = 0;
  private startClientY = 0;
  private initialX = 0;
  private initialY = 0;
  private initialW = 0;
  private initialH = 0;
  private resizeCorner: ResizeCorner = 'top-left';

  posX = signal(window.innerWidth - 340);
  posY = signal(window.innerHeight - 260);
  width = signal(320);
  height = signal(240);

  messages = signal<Message[]>([]);
  isLoadingMore = signal(false);
  hasMore = signal(true);
  private messagesPage = 1;
  private readonly messagesPageSize = 20;
  private boundConsultationId: number | null = null;
  private currentUser: IUser | null = null;

  constructor() {
    this.userService.currentUser$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(user => {
      this.currentUser = user;
    });

    // `messageUpdated$` is the one actually fed by the consultation WS
    // backend (event === 'message'); `messages$` is a different path used
    // for legacy `consultation_message` payloads and never fires in
    // practice, which is why the chat stayed empty.
    this.wsService.messageUpdated$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(event => {
      if (!this.boundConsultationId) return;
      if (event.state === 'created') {
        const newMessage = this.mapMessage(event.data);
        this.messages.update(msgs => {
          if (msgs.some(m => m.id === newMessage.id)) return msgs;
          return [...msgs, newMessage];
        });
      } else if (event.state === 'updated' || event.state === 'deleted') {
        this.reloadMessages();
      }
    });

    effect(() => {
      const call = this.activeCallService.activeCall();
      const consultationId = call?.consultationId ?? null;
      if (consultationId === this.boundConsultationId) return;

      this.boundConsultationId = consultationId;
      this.messages.set([]);
      this.messagesPage = 1;
      this.hasMore.set(true);

      // Don't explicitly disconnect: the ConsultationWebSocketService is a
      // root singleton also used by consultation-detail. Its `connect()` is
      // idempotent, so calling it here is safe. Disconnecting would risk
      // tearing down the socket consultation-detail still needs.
      if (consultationId !== null) {
        this.wsService.connect(consultationId);
        this.reloadMessages();
      }
    });
  }

  private mapMessage(msg: ConsultationMessage): Message {
    const isSystem = !msg.created_by;
    const isCurrentUser = !isSystem && msg.created_by.id === this.currentUser?.pk;
    const username = isSystem
      ? ''
      : isCurrentUser
        ? this.t.instant('consultationDetail.you')
        : `${msg.created_by.first_name} ${msg.created_by.last_name}`.trim() ||
          msg.created_by.email;
    return {
      id: msg.id,
      username,
      message: msg.content || '',
      timestamp: msg.created_at,
      isCurrentUser,
      isSystem,
      attachment: msg.attachment,
      recording_url: msg.recording_url,
      isEdited: msg.is_edited,
      updatedAt: msg.updated_at,
      deletedAt: msg.deleted_at,
    };
  }

  private reloadMessages(): void {
    const consultationId = this.boundConsultationId;
    if (consultationId === null) return;
    this.messagesPage = 1;
    this.consultationService
      .getConsultationMessages(consultationId, { page: 1, page_size: this.messagesPageSize })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: response => {
          this.hasMore.set(!!response.next);
          const loaded = response.results.map(m => this.mapMessage(m)).reverse();
          const unique = Array.from(new Map(loaded.map(m => [m.id, m])).values());
          this.messages.set(unique);
        },
      });
  }

  onLoadMoreMessages(): void {
    const consultationId = this.boundConsultationId;
    if (consultationId === null || this.isLoadingMore() || !this.hasMore()) return;
    this.isLoadingMore.set(true);
    this.messagesPage += 1;
    this.consultationService
      .getConsultationMessages(consultationId, {
        page: this.messagesPage,
        page_size: this.messagesPageSize,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: response => {
          this.hasMore.set(!!response.next);
          const loaded = response.results.map(m => this.mapMessage(m)).reverse();
          this.messages.update(current => {
            const merged = [...loaded, ...current];
            return Array.from(new Map(merged.map(m => [m.id, m])).values());
          });
          this.isLoadingMore.set(false);
        },
        error: () => {
          this.isLoadingMore.set(false);
        },
      });
  }

  onSendMessage(data: SendMessageData): void {
    const consultationId = this.boundConsultationId;
    if (consultationId === null) return;
    this.consultationService
      .sendConsultationMessage(consultationId, {
        content: data.content,
        attachment: data.attachment,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        error: error => {
          this.toasterService.show(
            'error',
            this.t.instant('consultationDetail.errorSendingMessage'),
            getErrorMessage(error)
          );
        },
      });
  }

  onEditMessage(data: EditMessageData): void {
    this.consultationService
      .updateConsultationMessage(data.messageId, data.content)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe();
  }

  onDeleteMessage(data: DeleteMessageData): void {
    this.consultationService
      .deleteConsultationMessage(data.messageId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe();
  }

  private getClient(event: MouseEvent | TouchEvent): { x: number; y: number } {
    if (event instanceof MouseEvent) {
      return { x: event.clientX, y: event.clientY };
    }
    return { x: event.touches[0].clientX, y: event.touches[0].clientY };
  }

  onDragStart(event: MouseEvent | TouchEvent): void {
    if (this.activeCallService.isFullscreen()) return;
    this.mode = 'drag';
    const { x, y } = this.getClient(event);
    this.startClientX = x;
    this.startClientY = y;
    this.initialX = this.posX();
    this.initialY = this.posY();
    event.preventDefault();
  }

  onResizeStart(event: MouseEvent | TouchEvent, corner: ResizeCorner): void {
    if (this.activeCallService.isFullscreen()) return;
    this.mode = 'resize';
    this.resizeCorner = corner;
    const { x, y } = this.getClient(event);
    this.startClientX = x;
    this.startClientY = y;
    this.initialW = this.width();
    this.initialH = this.height();
    this.initialX = this.posX();
    this.initialY = this.posY();
    event.preventDefault();
    event.stopPropagation();
  }

  @HostListener('document:mousemove', ['$event'])
  @HostListener('document:touchmove', ['$event'])
  onMove(event: MouseEvent | TouchEvent): void {
    if (this.mode === 'none') return;
    const { x, y } = this.getClient(event);
    const deltaX = x - this.startClientX;
    const deltaY = y - this.startClientY;

    if (this.mode === 'drag') {
      this.posX.set(Math.max(0, Math.min(window.innerWidth - this.width(), this.initialX + deltaX)));
      this.posY.set(Math.max(0, Math.min(window.innerHeight - this.height(), this.initialY + deltaY)));
    } else if (this.mode === 'resize') {
      let newW = this.initialW;
      let newH = this.initialH;
      let newX = this.initialX;
      let newY = this.initialY;

      switch (this.resizeCorner) {
        case 'top-left':
          newW = this.initialW - deltaX;
          newH = this.initialH - deltaY;
          newX = this.initialX + deltaX;
          newY = this.initialY + deltaY;
          break;
        case 'top-right':
          newW = this.initialW + deltaX;
          newH = this.initialH - deltaY;
          newY = this.initialY + deltaY;
          break;
        case 'bottom-left':
          newW = this.initialW - deltaX;
          newH = this.initialH + deltaY;
          newX = this.initialX + deltaX;
          break;
        case 'bottom-right':
          newW = this.initialW + deltaX;
          newH = this.initialH + deltaY;
          break;
      }

      newW = Math.max(240, Math.min(800, newW));
      newH = Math.max(180, Math.min(600, newH));

      // Adjust position only if the corner anchors require it
      if (this.resizeCorner.includes('left')) {
        this.posX.set(this.initialX + (this.initialW - newW));
      }
      if (this.resizeCorner.includes('top')) {
        this.posY.set(this.initialY + (this.initialH - newH));
      }

      this.width.set(newW);
      this.height.set(newH);
    }
  }

  @HostListener('document:mouseup')
  @HostListener('document:touchend')
  onEnd(): void {
    this.mode = 'none';
  }

  onCallEnded(): void {
    this.activeCallService.endCall();
    this.incomingCallService.clearActiveCall();
  }

  onToggleSize(): void {
    this.activeCallService.toggleFullscreen();
  }
}
