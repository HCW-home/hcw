import {
  Component,
  HostListener,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActiveCallService } from '../../../core/services/active-call.service';
import { ConsultationService } from '../../../core/services/consultation.service';
import { IncomingCallService } from '../../../core/services/incoming-call.service';
import { VideoConsultationComponent } from '../../../modules/user/components/video-consultation/video-consultation';

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
