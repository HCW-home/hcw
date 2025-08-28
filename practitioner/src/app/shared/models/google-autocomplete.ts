export interface Address {
  place_id: string;
  location: string;
}

export interface IPlace {
  lat: number;
  lng: number;
  county: string;
  city: string;
  state: string;
  country: string;
  place_id: string;
  postalCode: string;
  formatted_address: string;
  state_abbreviation: string;
}
