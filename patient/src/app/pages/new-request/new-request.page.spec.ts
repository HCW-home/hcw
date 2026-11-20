import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { importProvidersFrom } from '@angular/core';
import { IonicStorageModule } from '@ionic/storage-angular';
import { TranslateModule } from '@ngx-translate/core';
import { NewRequestPage } from './new-request.page';

describe('NewRequestPage', () => {
  let component: NewRequestPage;
  let fixture: ComponentFixture<NewRequestPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NewRequestPage, TranslateModule.forRoot()],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        importProvidersFrom(IonicStorageModule.forRoot()),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(NewRequestPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
