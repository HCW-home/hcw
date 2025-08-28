import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Sidebar } from '../../../../core/components/sidebar/sidebar';
import { Header } from '../../../../core/components/header/header';
import { Footer } from '../../../../core/components/footer/footer';

@Component({
  selector: 'app-admin',
  imports: [RouterOutlet, Sidebar, Header, Footer],
  templateUrl: './user.html',
  styleUrl: './user.scss',
})
export class User {}
