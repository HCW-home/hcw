import { Component, OnInit } from '@angular/core';
import { Toast } from '../../models/toast';
import { ToasterService } from '../../services/toaster.service';
import { ToasterComponent } from '../toaster/toaster.component';

@Component({
  selector: 'app-toaster-container',
  imports: [ToasterComponent],
  templateUrl: './toaster-container.component.html',
  styleUrl: './toaster-container.component.scss',
})
export class ToasterContainerComponent implements OnInit {
  toasts: Toast[] = [];

  constructor(protected toaster: ToasterService) {}

  ngOnInit() {
    this.toaster.toast$.subscribe(toast => {
      this.toasts = [toast, ...this.toasts];
      setTimeout(() => this.toasts.pop(), toast.delay || 5000);
    });
  }

  remove(index: number) {
    this.toasts = this.toasts.filter((v, i) => i !== index);
  }
}
