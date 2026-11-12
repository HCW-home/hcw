import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { Router, ActivatedRoute, provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { of } from 'rxjs';

import { BookingConfirmation } from './booking-confirmation';
import { BookingStateService } from '../../core/services/booking-state.service';

describe('BookingConfirmation', () => {
  let component: BookingConfirmation;
  let fixture: ComponentFixture<BookingConfirmation>;
  let bookingState: BookingStateService;
  let httpMock: HttpTestingController;
  let routerSpy: jasmine.Spy;

  function createParamMap(params: Record<string, string | null>): any {
    return {
      get: (key: string) => params[key] ?? null,
      getAll: (key: string) => (params[key] ? [params[key]!] : []),
      has: (key: string) => key in params && params[key] !== null,
      keys: Object.keys(params).filter(k => params[k] !== null),
    };
  }

  function createActivatedRoute(requestId: string | null) {
    const paramMap = createParamMap({ requestId });
    return {
      queryParamMap: of(paramMap),
      snapshot: { queryParamMap: paramMap },
    };
  }

  afterEach(() => {
    sessionStorage.clear();
    TestBed.resetTestingModule();
      });

  describe('after a successful submission with requestId in query params', () => {
    beforeEach(() => {
      TestBed.configureTestingModule({
        imports: [BookingConfirmation],
        providers: [
          provideHttpClient(),
          ...provideHttpClientTesting(),
          provideRouter([]),
          { provide: Router, useValue: { getCurrentNavigation: () => null, navigate: jasmine.createSpy('navigate') } },
          { provide: ActivatedRoute, useValue: createActivatedRoute('42') },
        ],
      }).compileComponents();

      fixture = TestBed.createComponent(BookingConfirmation);
      component = fixture.componentInstance;
      bookingState = TestBed.inject(BookingStateService);
      httpMock = TestBed.inject(HttpTestingController);
      routerSpy = TestBed.inject(Router).navigate as jasmine.Spy;
    });

    afterEach(() => {
      httpMock.verify();
      sessionStorage.clear();
      TestBed.resetTestingModule();
    });

    it('fetches the request from the backend', fakeAsync(() => {
      fixture.detectChanges();
      tick();

      expect(component.isLoading).toBe(true);
      expect(component.hasSubmission).toBe(false);

      const req = httpMock.expectOne('http://localhost:8000/api/requests/42/');
      expect(req.request.method).toBe('GET');
      req.flush({ id: 42, status: 'requested', expected_at: '2026-10-14T14:00:00+02:00' });
      tick();

      expect(component.isLoading).toBe(false);
      expect(component.hasSubmission).toBe(true);
      expect(component.request).not.toBeNull();
      expect(component.request?.id).toBe(42);
      expect(component.request?.status).toBe('requested');
    });

    it('never claims the appointment is confirmed, scheduled or paid', fakeAsync(() => {
      fixture.detectChanges();
      tick();

      const req = httpMock.expectOne('http://localhost:8000/api/requests/42/');
      expect(req.request.method).toBe('GET');
      req.flush({ id: 42, status: 'requested' });
      tick();

      const text = fixture.nativeElement.textContent as string;

      expect(text).toContain('awaiting processing');
      expect(text).not.toContain('appointment is confirmed');
      expect(text).not.toContain('Appointment Confirmed');
      expect(text).not.toContain('booking is confirmed');
      expect(text).not.toContain('payment received');
      expect(text).not.toContain('You have successfully booked');
      expect(text).toContain('not yet a confirmed appointment');
    });

    it('renders the request reference and a pending status', fakeAsync(() => {
      fixture.detectChanges();
      tick();

      const req = httpMock.expectOne('http://localhost:8000/api/requests/42/');
      expect(req.request.method).toBe('GET');
      req.flush({ id: 42, status: 'requested' });
      tick();

      const text = fixture.nativeElement.textContent as string;

      expect(text).toContain('#42');
      expect(text).toContain('requested');
      expect(text).toContain('Request reference');
    });

    it('does not read the booking draft for the request', fakeAsync(() => {
      fixture.detectChanges();
      tick();

      const req = httpMock.expectOne('http://localhost:8000/api/requests/42/');
      expect(req.request.method).toBe('GET');
      req.flush({ id: 42, status: 'requested' });
      tick();

      expect(component.pendingDraft).toBe(false);
    });
      });

  describe('reached without a submission', () => {
    beforeEach(() => {
      TestBed.configureTestingModule({
        imports: [BookingConfirmation],
        providers: [
          provideHttpClient(),
          ...provideHttpClientTesting(),
          provideRouter([]),
          { provide: Router, useValue: { getCurrentNavigation: () => null, navigate: jasmine.createSpy('navigate') } },
          { provide: ActivatedRoute, useValue: { queryParamMap: of({ get: () => null, getAll: () => [], has: () => false, keys: [] }), snapshot: { queryParamMap: { get: () => null, getAll: () => [], has: () => false, keys: [] } } } },
        ],
      }).compileComponents();

      fixture = TestBed.createComponent(BookingConfirmation);
      component = fixture.componentInstance;
      bookingState = TestBed.inject(BookingStateService);
      httpMock = TestBed.inject(HttpTestingController);
    });

    afterEach(() => {
      httpMock.verify();
      sessionStorage.clear();
      TestBed.resetTestingModule();
    });

    it('shows an honest fallback for a direct navigation', () => {
      fixture.detectChanges();

      expect(component.isLoading).toBe(false);
      expect(component.hasSubmission).toBe(false);
      expect(component.request).toBeNull();

      const text = fixture.nativeElement.textContent as string;
      expect(text).toContain('There is no request to show');
      expect(text).not.toContain('#');
    });

    it('shows an honest fallback for a reload', fakeAsync(() => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        imports: [BookingConfirmation],
        providers: [
          provideHttpClient(),
          ...provideHttpClientTesting(),
          provideRouter([]),
          { provide: Router, useValue: { getCurrentNavigation: () => null, navigate: jasmine.createSpy('navigate') } },
          { provide: ActivatedRoute, useValue: { queryParamMap: of({ get: (k: string) => (k === 'requestId' ? '42' : null), getAll: () => [], has: (k: string) => k === 'requestId', keys: ['requestId'] }), snapshot: { queryParamMap: { get: (k: string) => (k === 'requestId' ? '42' : null), getAll: () => [], has: (k: string) => k === 'requestId', keys: ['requestId'] } } } },
        ],
      }).compileComponents();

      fixture = TestBed.createComponent(BookingConfirmation);
      component = fixture.componentInstance;
      httpMock = TestBed.inject(HttpTestingController);
      fixture.detectChanges();
      tick();

      const req = httpMock.expectOne('http://localhost:8000/api/requests/42/');
      expect(req.request.method).toBe('GET');
      req.flush({ id: 42, status: 'requested' });
      tick();

      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        imports: [BookingConfirmation],
        providers: [
          provideHttpClient(),
          ...provideHttpClientTesting(),
          provideRouter([]),
          { provide: Router, useValue: { getCurrentNavigation: () => null, navigate: jasmine.createSpy('navigate') } },
          { provide: ActivatedRoute, useValue: { queryParamMap: of({ get: () => null, getAll: () => [], has: () => false, keys: [] }), snapshot: { queryParamMap: { get: () => null, getAll: () => [], has: () => false, keys: [] } } } },
        ],
      }).compileComponents();

      fixture = TestBed.createComponent(BookingConfirmation);
      component = fixture.componentInstance;
      httpMock = TestBed.inject(HttpTestingController);
      fixture.detectChanges();

      expect(component.hasSubmission).toBe(false);
      expect(component.request).toBeNull();

      const text = fixture.nativeElement.textContent as string;
      expect(text).toContain('There is no request to show');
    });

    it('offers to continue when a booking is still unsent', () => {
      bookingState.saveAppointment({
        doctorId: 42,
        reasonId: 12,
        date: '2026-10-15',
        startTime: '10:00:00',
      });

      const fresh = TestBed.createComponent(BookingConfirmation);
      fresh.detectChanges();

      expect(fresh.componentInstance.pendingDraft).toBe(true);
      expect(fresh.nativeElement.textContent).toContain('has not been sent yet');
    });

    it('does not offer to continue when no booking is in progress', () => {
      expect(component.pendingDraft).toBe(false);
    });
      });

  describe('fetch error handling', () => {
    let component: BookingConfirmation;
    let fixture: ComponentFixture<BookingConfirmation>;
    let httpMock: HttpTestingController;

    afterEach(() => {
      httpMock.verify();
      sessionStorage.clear();
      TestBed.resetTestingModule();
    });

    it('shows an error when the request is not found', fakeAsync(() => {
      TestBed.configureTestingModule({
        imports: [BookingConfirmation],
        providers: [
          provideHttpClient(),
          ...provideHttpClientTesting(),
          provideRouter([]),
          { provide: Router, useValue: { getCurrentNavigation: () => null, navigate: jasmine.createSpy('navigate') } },
          { provide: ActivatedRoute, useValue: { queryParamMap: of({ get: (k: string) => (k === 'requestId' ? '999' : null), getAll: () => [], has: (k: string) => k === 'requestId', keys: ['requestId'] }), snapshot: { queryParamMap: { get: (k: string) => (k === 'requestId' ? '999' : null), getAll: () => [], has: (k: string) => k === 'requestId', keys: ['requestId'] } } } },
        ],
      }).compileComponents();

      fixture = TestBed.createComponent(BookingConfirmation);
      component = fixture.componentInstance;
      httpMock = TestBed.inject(HttpTestingController);

      fixture.detectChanges();
      tick();

      const req = httpMock.expectOne('http://localhost:8000/api/requests/999/');
      req.flush({ detail: 'Not found.' }, { status: 404, statusText: 'Not Found' });
      tick();

      expect(component.isLoading).toBe(false);
      expect(component.hasSubmission).toBe(false);
      expect(component.errorMessage).toContain('could not be found');

      const text = fixture.nativeElement.textContent as string;
      expect(text).toContain('Unable to load request');
    });

    it('shows an error when the session has expired', fakeAsync(() => {
      TestBed.configureTestingModule({
        imports: [BookingConfirmation],
        providers: [
          provideHttpClient(),
          ...provideHttpClientTesting(),
          provideRouter([]),
          { provide: Router, useValue: { getCurrentNavigation: () => null, navigate: jasmine.createSpy('navigate') } },
          { provide: ActivatedRoute, useValue: { queryParamMap: of({ get: (k: string) => (k === 'requestId' ? '42' : null), getAll: () => [], has: (k: string) => k === 'requestId', keys: ['requestId'] }), snapshot: { queryParamMap: { get: (k: string) => (k === 'requestId' ? '42' : null), getAll: () => [], has: (k: string) => k === 'requestId', keys: ['requestId'] } } } },
        ],
      }).compileComponents();

      fixture = TestBed.createComponent(BookingConfirmation);
      component = fixture.componentInstance;
      httpMock = TestBed.inject(HttpTestingController);

      fixture.detectChanges();
      tick();

      const req = httpMock.expectOne('http://localhost:8000/api/requests/42/');
      req.flush({ detail: 'Authentication credentials were not provided.' }, { status: 401, statusText: 'Unauthorized' });
      tick();

      expect(component.isLoading).toBe(false);
      expect(component.errorMessage).toContain('session has expired');

      const text = fixture.nativeElement.textContent as string;
      expect(text).toContain('Unable to load request');
    });
      });


}