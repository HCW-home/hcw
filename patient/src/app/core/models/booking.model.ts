export interface BookingSlot {
  id: number;
  user: number;
  created_by: number;
  start_time: string;
  end_time: string;
  start_break?: string;
  end_break?: string;
  monday: boolean;
  tuesday: boolean;
  wednesday: boolean;
  thursday: boolean;
  friday: boolean;
  saturday: boolean;
  sunday: boolean;
  valid_until?: string;
  created_at?: string;
}

export interface TimeSlot {
  date: string;
  start_time: string;
  end_time: string;
  is_available: boolean;
  reason_id?: number;
  doctor_id?: number;
}

export interface AvailableSlot {
  datetime: string;
  duration: number;
  doctor: {
    id: number;
    first_name: string;
    last_name: string;
  };
}
