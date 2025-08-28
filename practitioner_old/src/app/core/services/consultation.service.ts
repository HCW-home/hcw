import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, BehaviorSubject, Subject } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';

export interface Consultation {
  id: number;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  beneficiary: any | null;
  created_by: any;
  owned_by: any;
  group: any | null;
  appointments: any[];
  messages: any[];
}

export interface Message {
  id: number;
  content: string;
  subject: string;
  message_type: 'sms' | 'email' | 'whatsapp' | 'push';
  provider_name: string;
  recipient_phone: string;
  recipient_email: string;
  status: 'pending' | 'sent' | 'delivered' | 'failed' | 'read';
  sent_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
  failed_at: string | null;
  sent_by: any;
  participant: any | null;
  celery_task_id: string;
  created_at: string;
  updated_at: string;
}

export interface ConsultationMessage {
  id: number;
  content: string;
  sender: any;
  created_at: string;
  message_type: 'text' | 'file';
}

export interface ConsultationRoom {
  consultation_id: number;
  participants: string[];
  messages: Message[];
  status: 'waiting' | 'active' | 'ended';
}

@Injectable({
  providedIn: 'root'
})
export class ConsultationService {
  private readonly API_URL = environment.apiUrl;
  private readonly WS_URL = environment.wsUrl;

  // WebSocket connection
  private socket: WebSocket | null = null;
  private currentConsultationId: number | null = null;

  // Callback for handling video messages
  public onWebSocketMessage: ((data: any) => void) | null = null;

  // Observables for real-time updates
  private consultationRoomSubject = new BehaviorSubject<ConsultationRoom | null>(null);
  private messagesSubject = new BehaviorSubject<ConsultationMessage[]>([]);
  private connectionStatusSubject = new BehaviorSubject<'disconnected' | 'connecting' | 'connected'>('disconnected');

  public consultationRoom$ = this.consultationRoomSubject.asObservable();
  public messages$ = this.messagesSubject.asObservable();
  public connectionStatus$ = this.connectionStatusSubject.asObservable();

  constructor(
    private http: HttpClient,
    private authService: AuthService
  ) {}

  private getAuthHeaders(): HttpHeaders {
    const token = this.authService.getToken();
    return new HttpHeaders({
      'Authorization': token ? `Bearer ${token}` : ''
    });
  }

  // REST API Methods
  getConsultations(): Observable<Consultation[]> {
    return this.http.get<Consultation[]>(`${this.API_URL}/consultations/`, {
      headers: this.getAuthHeaders()
    });
  }

  getConsultation(id: number): Observable<Consultation> {
    return this.http.get<Consultation>(`${this.API_URL}/consultations/${id}/`, {
      headers: this.getAuthHeaders()
    });
  }

  createConsultation(consultationData: any): Observable<Consultation> {
    return this.http.post<Consultation>(`${this.API_URL}/consultations/`, consultationData, {
      headers: this.getAuthHeaders()
    });
  }

  updateConsultation(id: number, consultationData: any): Observable<Consultation> {
    return this.http.put<Consultation>(`${this.API_URL}/consultations/${id}/`, consultationData, {
      headers: this.getAuthHeaders()
    });
  }

  closeConsultation(id: number): Observable<Consultation> {
    return this.http.post<Consultation>(`${this.API_URL}/consultations/${id}/close/`, {}, {
      headers: this.getAuthHeaders()
    });
  }

  reopenConsultation(id: number): Observable<Consultation> {
    return this.http.post<Consultation>(`${this.API_URL}/consultations/${id}/reopen/`, {}, {
      headers: this.getAuthHeaders()
    });
  }

  getConsultationMessages(id: number): Observable<Message[]> {
    return this.http.get<Message[]>(`${this.API_URL}/consultations/${id}/messages/`, {
      headers: this.getAuthHeaders()
    });
  }

  sendConsultationMessage(id: number, messageData: any): Observable<Message> {
    return this.http.post<Message>(`${this.API_URL}/consultations/${id}/send_message/`, messageData, {
      headers: this.getAuthHeaders()
    });
  }

  // WebSocket Methods
  connectToConsultation(consultationId: number): void {
    if (this.socket && this.currentConsultationId === consultationId) {
      console.log('Already connected to this consultation');
      return;
    }

    this.disconnectFromConsultation();
    this.currentConsultationId = consultationId;
    this.connectionStatusSubject.next('connecting');

    const token = this.authService.getToken();
    const wsUrl = `${this.WS_URL}/consultation/${consultationId}/?token=${token}`;

    try {
      this.socket = new WebSocket(wsUrl);

      this.socket.onopen = (event) => {
        console.log('WebSocket connected to consultation:', consultationId);
        this.connectionStatusSubject.next('connected');

        // Send join message
        this.sendWebSocketMessage({
          type: 'create_room',
          consultation_id: consultationId
        });
      };

      this.socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handleWebSocketMessage(data);
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      this.socket.onclose = (event) => {
        console.log('WebSocket connection closed:', event.code, event.reason);
        this.connectionStatusSubject.next('disconnected');

        // Attempt reconnection after 3 seconds if not intentionally closed
        if (event.code !== 1000 && this.currentConsultationId) {
          setTimeout(() => {
            if (this.currentConsultationId === consultationId) {
              console.log('Attempting to reconnect...');
              this.connectToConsultation(consultationId);
            }
          }, 3000);
        }
      };

      this.socket.onerror = (error) => {
        console.error('WebSocket error:', error);
        this.connectionStatusSubject.next('disconnected');
      };

    } catch (error) {
      console.error('Error creating WebSocket connection:', error);
      this.connectionStatusSubject.next('disconnected');
    }
  }

  disconnectFromConsultation(): void {
    if (this.socket) {
      this.socket.close(1000, 'Intentional disconnect');
      this.socket = null;
    }
    this.currentConsultationId = null;
    this.connectionStatusSubject.next('disconnected');
    this.consultationRoomSubject.next(null);
    this.messagesSubject.next([]);
  }

  // Alias for disconnectFromConsultation
  disconnect(): void {
    this.disconnectFromConsultation();
  }

  sendMessage(content: string, messageType: 'text' | 'file' = 'text'): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.sendWebSocketMessage({
        type: 'chat_message',
        message: content,
        message_type: messageType,
        consultation_id: this.currentConsultationId
      });
    } else {
      console.error('WebSocket is not connected');
    }
  }

  sendVideoMessage(message: any): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.sendWebSocketMessage(message);
    } else {
      console.error('WebSocket is not connected for video message');
    }
  }

  private sendWebSocketMessage(data: any): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(data));
    }
  }

  private handleWebSocketMessage(data: any): void {
    // First, call the video message callback if it exists
    if (this.onWebSocketMessage) {
      this.onWebSocketMessage(data);
    }

    switch (data.type) {
      case 'consultation_room_update':
        this.consultationRoomSubject.next(data.room);
        break;

      case 'new_message':
        const currentMessages = this.messagesSubject.value;
        this.messagesSubject.next([...currentMessages, data.message]);
        break;

      case 'message_status_update':
        const messages = this.messagesSubject.value;
        const updatedMessages = messages.map(msg =>
          msg.id === data.message_id ? { ...msg, status: data.status } : msg
        );
        this.messagesSubject.next(updatedMessages);
        break;

      case 'participant_joined':
        console.log('Participant joined:', data.participant);
        break;

      case 'participant_left':
        console.log('Participant left:', data.participant);
        break;

      case 'consultation_ended':
        console.log('Consultation ended');
        this.disconnectFromConsultation();
        break;

      case 'error':
        console.error('WebSocket error from server:', data.message);
        break;

      case 'janus_event':
      case 'room_created':
      case 'participants':
        // These are handled by the video message callback
        // No need to log them as unknown
        break;

      default:
        console.log('Unknown WebSocket message type:', data.type);
    }
  }

  // Utility Methods
  isConnectedToConsultation(consultationId: number): boolean {
    return this.currentConsultationId === consultationId &&
           this.connectionStatusSubject.value === 'connected';
  }

  getCurrentConsultationId(): number | null {
    return this.currentConsultationId;
  }

  // Clean up on service destroy
  ngOnDestroy(): void {
    this.disconnectFromConsultation();
  }
}
