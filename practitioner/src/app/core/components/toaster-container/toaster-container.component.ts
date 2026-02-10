import { Component, inject } from '@angular/core';
import { AsyncPipe } from '@angular/common';
import { ToasterService } from '../../services/toaster.service';
import { ToasterComponent } from '../toaster/toaster.component';

@Component({
  selector: 'app-toaster-container',
  imports: [AsyncPipe, ToasterComponent],
  templateUrl: './toaster-container.component.html',
  styleUrl: './toaster-container.component.scss',
})
export class ToasterContainerComponent {
  protected toaster = inject(ToasterService);
}
