import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import {ToasterContainerComponent} from './core/components/toaster-container/toaster-container.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, ToasterContainerComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  protected title = 'practitioner';
}
