import {Component, OnInit, ViewChild, CUSTOM_ELEMENTS_SCHEMA, ElementRef} from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, NavController } from '@ionic/angular';
import { StorageService } from '../../core/services/storage.service';
import { SwiperContainer } from 'swiper/element';

@Component({
  selector: 'app-onboarding',
  templateUrl: './onboarding.page.html',
  styleUrls: ['./onboarding.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA]
})
export class OnboardingPage implements OnInit {
  @ViewChild('swiper') swiper!: ElementRef<SwiperContainer>;

  slides = [
    {
      title: 'Find Specialist Doctors',
      subtitle: 'Find a lot of specialist doctors in your area',
      image: 'assets/images/onboarding-1.png'
    },
    {
      title: 'Get Expert Advice',
      subtitle: 'Get advice only from a doctor you believe in',
      image: 'assets/images/onboarding-2.png'
    },
    {
      title: 'Your Health Journey',
      subtitle: "Let's get started with your personalized healthcare",
      image: 'assets/images/onboarding-3.svg'
    }
  ];

  constructor(
    private navCtrl: NavController,
    private storage: StorageService
  ) { }

  async ngOnInit() {
    const hasSeenOnboarding = await this.storage.get('hasSeenOnboarding');
    if (hasSeenOnboarding) {
      this.navCtrl.navigateRoot('/login');
    }
  }

  ionViewDidEnter() {
    if (this.swiper) {
      this.swiper.nativeElement.initialize();
    }
  }

  async skip() {
    await this.storage.set('hasSeenOnboarding', true);
    this.navCtrl.navigateRoot('/login');
  }

  async next() {
    const swiperEl = this.swiper.nativeElement;
    console.log(swiperEl);
    const isEnd = swiperEl.swiper.isEnd;

    if (isEnd) {
      await this.storage.set('hasSeenOnboarding', true);
      this.navCtrl.navigateRoot('/login');
    } else {
      swiperEl.swiper.slideNext();
    }
  }
}
