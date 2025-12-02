# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a healthcare consultation web application with a **multi-service architecture**:

- **practitioner/**: Angular 20 frontend for healthcare practitioners
- **patient/**: Ionic Angular mobile app for patients  
- **backend/**: Django REST API with WebRTC, real-time messaging, and async task processing
- **Root-level Makefile**: Coordinates building across all services

## Development Commands

### Practitioner Frontend (Angular 20)
Navigate to `practitioner/` directory:
- **Start development server**: `ng serve` (serves at http://localhost:4200)
- **Build application**: `ng build` (outputs to dist/)
- **Build for production**: `ng build --configuration production`
- **Run tests**: `ng test` (uses Karma + Jasmine)
- **Lint code**: `ng lint` (uses Angular ESLint with TypeScript and template rules)
- **Generate components**: `ng generate component component-name`
- **Watch build**: `ng build --watch --configuration development`
- **Extract i18n**: `ng extract-i18n`

### Patient Mobile App (Ionic Angular)
Navigate to `patient/` directory:
- **Start development server**: `ng serve`
- **Build application**: `ng build` 
- **Run tests**: `ng test`
- **Lint code**: `ng lint`

### Backend (Django)
Navigate to `backend/` directory:
- **Run development server**: `python3 manage.py runserver`
- **Create superuser**: `python3 manage.py createsuperuser`
- **Run migrations**: `python3 manage.py migrate`
- **Create migrations**: `python3 manage.py makemigrations`
- **Load initial data**: `python3 manage.py loaddata initial/Groups.json`
- **Run Celery worker**: `celery -A core worker --loglevel=info`
- **Extract translations**: `./manage.py makemessages --locale=fr --ignore='venv/*'`
- **Compile translations**: `./manage.py compilemessages --ignore='venv/*'`

### Root Level
- **Build all services**: `make build`
- **Install all dependencies**: `make install`
- **Clean all services**: `make clean`

## Project Architecture

### Frontend Architecture (Practitioner)
This is an Angular 20 application with a modular architecture:

### Core Structure
- **Core Module** (`src/app/core/`): Contains shared services, guards, constants, and models
  - **Services**: `AdminAuth`, `ToasterService`, `ValidationService`, `WebSocketService`, `ConsultationService`, `UserService`
  - **Models**: Data interfaces and types with strict TypeScript typing
- **Feature Modules**:
  - `auth/` - Authentication module with login, forgot password, reset password
  - `user/` - Main application module with dashboard, consultations, availability, test pages
- **Shared Module** (`src/app/shared/`): Reusable UI components, animations, tools, and utilities

### Key Architectural Patterns
- **Lazy Loading**: Feature modules are loaded on-demand using `loadChildren`
- **Route Guards**: Authentication guards (`redirectIfAuthenticated`, `redirectIfUnauthenticated`)
- **Standalone Components**: Uses Angular's modern standalone component architecture
- **Modular Services**: Core services like `AdminAuth`, `ToasterService`, `ValidationService`
- **Environment-based Configuration**: Separate environment files for development/production

### Component Organization
- Components follow Angular naming conventions: `component-name.ts`, `component-name.html`, `component-name.scss`
- Shared UI components in `shared/ui-components/` for reusability
- Page-specific components in respective module directories

### Styling
- Uses SCSS with global styles in `src/styles.scss` and `public/styles/`
- Component-scoped styling
- Source Sans Pro font family
- Normalized CSS and custom variables

### Authentication Flow
- Token-based authentication stored in localStorage
- Route-level protection with guards
- Service-based authentication management (`AdminAuth`)

### Dependencies & Libraries
- **ngx-mask**: Form input masking
- **angular-svg-icon**: SVG icon management  
- **google-libphonenumber**: Phone number validation (CommonJS dependency allowed in build)
- **ESLint**: Code linting with Angular-specific rules (custom rules: input rename allowed, component class suffix disabled)
- **Prettier**: Code formatting
- **TypeScript ESLint**: Advanced TypeScript linting with stylistic rules

### Testing
- Karma + Jasmine for unit tests
- Test files follow `*.spec.ts` convention

### Backend Architecture (Django)
The backend is a Django 5.2 REST API with advanced real-time capabilities:

#### Core Django Apps
- **api/**: REST API endpoints and serializers
- **core/**: Project settings, Celery configuration, and shared utilities
- **users/**: User management, authentication, and profiles
- **consultations/**: Healthcare consultation logic and WebRTC integration
- **messaging/**: Real-time messaging system with WebSocket support
- **organisations/**: Multi-tenant organization management
- **mediaserver/**: File upload and media handling
- **configuration/**: Application configuration and settings management

#### Key Technologies
- **Django REST Framework**: API endpoints with JWT authentication
- **Django Channels**: WebSocket support for real-time features
- **Celery**: Asynchronous task processing with Redis backend
- **aiortc**: WebRTC implementation for video consultations
- **Firebase Admin**: Push notifications and cloud messaging
- **PostgreSQL**: Primary database (implied by psycopg dependency)
- **Redis**: Caching and Celery message broker
- **Django Unfold**: Modern admin interface

#### Real-time Features
- **WebRTC Video/Audio**: Healthcare consultations with video calling
- **WebSocket Messaging**: Real-time chat and notifications
- **Async Task Processing**: Background jobs with Celery
- **Push Notifications**: Firebase Cloud Messaging integration

#### Internationalization
- **Multi-language Support**: French translation support with gettext
- **Time Zones**: Django timezone handling for global users

#### Security & Authentication
- **JWT Token Authentication**: Secure API access
- **Django Allauth**: Social authentication and user management
- **CORS Headers**: Cross-origin resource sharing configuration
- **Group-based Permissions**: Role-based access control for healthcare providers

## UI Component Library

The project includes a comprehensive shared UI component library in `src/app/shared/ui-components/`. **ALWAYS use these components instead of creating new ones.**

### Form Components (All support Angular Reactive Forms)
- `<app-input>` - Text inputs with icons, validation, password toggle, date support
- `<app-mask-input>` - Masked inputs using ngx-mask for formatting (phone, SSN, etc.)
- `<app-phone-input>` - Phone number input with built-in validation
- `<app-select>` - Advanced dropdown with search, multi-select, and creatable options
- `<app-checkbox>` - Checkbox with label and disabled states
- `<app-radio>` - Radio button groups with flexible layouts
- `<app-textarea>` - Multi-line text input
- `<app-switch>` - Toggle switch component

### UI Elements
- `<app-button>` - Buttons with multiple styles (primary, stroke, text, filled-stroke), sizes (large, medium, small), states (default, secondary, error), icons, and loading states
- `<app-typography>` - Comprehensive text system with variants (h1-h6, body-xxl to body-xxs, all weights: regular, medium, semibold, bold)
- `<app-svg>` - SVG icon wrapper (uses angular-svg-icon, icons in `public/svg/`)
- `<app-label>` - Form labels with consistent styling
- `<app-link>` - Styled navigation and action links
- `<app-accordion>` - Collapsible content sections

### Layout & Feedback Components
- `<app-modal>` - Modal dialogs (currently being implemented)
- `<app-loader>` - Loading spinners and indicators
- `<app-overlay>` - Background overlays for modals
- `<app-badge>` - Status and notification badges
- `<error-message>` - Form validation error display
- `<app-pagination>` - Page navigation controls
- `<app-back-button>` - Consistent back navigation
- `<app-breadcrumb>` - Breadcrumb navigation trail
- `<app-message-list>` - Real-time message display with send input, connection status indicator, message history

### Usage Guidelines
1. **Import directly**: All components are standalone, import them directly in your component
2. **Form integration**: Form components implement ControlValueAccessor for seamless reactive forms
3. **Typography**: Use `TypographyTypeEnum` constants for consistent text styling
4. **Icons**: Reference SVG files from `public/svg/` directory in `<app-svg src="icon-name">`
5. **Validation**: Use `invalid` and `invalidMessage` inputs on form components

## Core Services

### WebSocketService
**Location**: `src/app/core/services/websocket.service.ts`
**Models**: `src/app/core/models/websocket.ts`

Centralized WebSocket management service with:
- Auto-reconnection logic with configurable attempts and intervals
- Connection state management (`CONNECTING`, `CONNECTED`, `DISCONNECTED`, `RECONNECTING`, `FAILED`)
- Message queuing for offline scenarios
- Type-safe event subscription system
- Ping/pong heartbeat support
- Group join/leave functionality

**Backend Endpoints:**
- `ws://host/ws/user/` - User notifications, online status, messages
- `ws://host/ws/consultation/{id}/` - Consultation-specific events, WebRTC signaling

### UserWebSocketService
**Location**: `src/app/core/services/user-websocket.service.ts`

User-specific WebSocket service that wraps WebSocketService:
- Automatically connects when user is authenticated
- Manages user online status and connection count
- Handles user messages and notifications
- Group management for consultations and organizations
- Integrated with Auth service for token-based connection

**Features:**
- `isOnline$` - Observable for user online status
- `connectionCount$` - Observable for active connection count
- `messages$` - Observable for incoming user messages
- `notifications$` - Observable for system notifications
- `joinConsultationGroup(id)` - Join consultation-specific group
- `leaveConsultationGroup(id)` - Leave consultation group
- `sendMessage(userId, message)` - Send message to another user

**Auto-connection**: Integrated into App component - connects automatically when user logs in and disconnects on logout.

### ConsultationWebSocketService
**Location**: `src/app/core/services/consultation-websocket.service.ts`

Consultation-specific WebSocket service for real-time consultation updates:
- Connects to specific consultation room
- Handles real-time messages within consultations
- Tracks participant join/leave events
- Monitors appointment status changes
- Auto-reconnection with consultation context

**Features:**
- `messages$` - Observable for consultation messages
- `participants$` - Observable for participant list
- `participantJoined$` - Observable for join notifications
- `participantLeft$` - Observable for leave notifications
- `appointmentUpdated$` - Observable for appointment changes
- `sendMessage(message)` - Send message in consultation
- `getParticipants()` - Request current participants list

**Integration**: Connected in `consultation-detail.ts` - auto-connects when viewing consultation and disconnects on leave.

## Development Guidelines (CRITICAL - ALWAYS FOLLOW)

### Component Reusability Principle
**BEFORE creating ANY new component or functionality:**
1. **Check if a reusable component exists** in `src/app/shared/ui-components/` or `src/app/shared/components/`
2. **If component exists** - USE IT, do not recreate
3. **If component does NOT exist** - CREATE a reusable component in the appropriate shared directory
4. **Update CLAUDE.md** - Document the new component in the UI Component Library section for future reference

### TypeScript Strict Typing
- **ALWAYS add explicit types** to all variables, parameters, return types, and properties
- **NEVER use `any` type** - Always define proper interfaces, types, or use specific types
- **Create interfaces/types** for all data structures in `src/app/core/models/` or feature-specific models
- Examples:
  - ❌ `function getData(): any`
  - ✅ `function getData(): Consultation[]`
  - ❌ `const data: any = response`
  - ✅ `const data: ApiResponse<Consultation> = response`

### Development Workflow
1. **Plan the component/feature** - Check existing components first
2. **Create types/interfaces** - Define all data structures with proper typing
3. **Implement step by step** - One feature at a time, test as you go
4. **Build after each change** - Run `npm run build` to verify no type errors or build issues
5. **Update documentation** - Add new components/patterns to CLAUDE.md

### Verification Steps
- **After ANY code change**: Run `npm run build` in practitioner directory
- **Fix ALL build errors** before proceeding to next step
- **Ensure type safety** - No implicit any, no type errors
- **Test functionality** - Verify the feature works as expected

## Text and Content Guidelines

### No Emojis Policy
- **NEVER use emojis** in UI text, form labels, messages, or any user-facing content
- This includes info messages, validation errors, help text, and notifications
- Use clear, descriptive text instead of emojis for better accessibility and professionalism
- Examples:
  - ❌ "💡 Your communication method determines..."
  - ✅ "Your communication method determines..."
  - ❌ "⚠️ You have unsaved changes"
  - ✅ "You have unsaved changes"

## Build Configuration

### Bundle Size Limits
- **Initial bundle**: Warning at 900kB, Error at 1MB
- **Component styles**: Warning at 8kB, Error at 16kB

### Environment Files
- `environment.ts`: Production environment (default)
- `environment.development.ts`: Development environment with debugging enabled

### ESLint Custom Rules
- Input renaming is allowed (`@angular-eslint/no-input-rename`: off)
- Component class suffix requirement is disabled (`@angular-eslint/component-class-suffix`: off)
- Negated async pipes in templates are allowed (`@angular-eslint/template/no-negated-async`: off)

## Current Project Status

### Feature Implementation Status

#### Completed Features ✅
- **Authentication**: Login, password reset, password recovery - fully functional
- **User Profile**: View and edit user profile with language, timezone, communication preferences
- **Consultations List**: View active and past consultations with filtering
- **Consultation Detail**: View consultation details, appointments, participants
- **Consultation Form**: Create and edit consultations with appointments
- **Availability Management**: Manage weekly schedules and time slots for booking
- **System Test**: Camera, microphone, and speaker testing for WebRTC readiness
- **Form Components**: All form UI components are fully implemented and working
- **Navigation**: Routing, breadcrumbs, back buttons all functional
- **User WebSocket Connection**: Real-time user notifications, online status tracking, auto-connects on login
- **Consultation Real-time WebSocket**: Real-time messages, participant notifications, appointment updates in consultation detail
- **Message List Component**: Real-time message display with connection status and send functionality

#### Partially Implemented Features ⚠️
- **Dashboard** (`src/app/modules/user/components/dashboard/dashboard.ts`):
  - Only 13 lines of code
  - Empty placeholder with no statistics, widgets, or data visualization
  - Needs: Recent consultations, upcoming appointments, quick stats, activity feed

- **Modal Component** (`src/app/shared/components/modal/modal.component.ts`):
  - Empty implementation (11 lines total)
  - Currently using native `confirm()` dialogs in 4 places
  - Needs: Full modal dialog implementation with header, body, footer, actions

#### Not Implemented Features ❌

- **WebRTC Video Consultations**:
  - Backend has aiortc and media server integration (Janus/LiveKit)
  - Frontend has no WebRTC client implementation
  - "Join Consultation" button does nothing (`consultations.ts:79`)
  - Test page validates camera/microphone but doesn't connect to backend

### Unused Components (Can be removed or integrated)

The following UI components exist but are NOT used anywhere in the application:

1. **`src/app/shared/ui-components/accordion/`** - Collapsible sections component (NOT USED)
2. **`src/app/shared/ui-components/checkbox/`** - Checkbox form control (NOT USED)
3. **`src/app/shared/ui-components/radio/`** - Radio button groups (NOT USED)
4. **`src/app/shared/ui-components/mask-input/`** - Masked input using ngx-mask (NOT USED)
5. **`src/app/shared/ui-components/phone-input/`** - Phone number input (NOT USED)
6. **`src/app/shared/components/pagination/`** - Pagination controls (NOT USED)
7. **`src/app/shared/components/overlay/`** - Background overlay (minimal usage, only for modals)

**Note**: Switch component is used in availability management, so it should remain.

### Technical Debt

#### Code Quality Issues
- **Console.log statements**: 29 instances across 7 files that should be replaced with proper logging
  - `availability.ts`: Lines 167, 226, 312, 333
  - `consultations.ts`: Lines 79, 87, 117
  - `consultation-detail.ts`: Lines 122, 140, 160, 196, 221, 252, 276, 300
  - `user-profile.ts`: Lines 105, 162, 189
  - `test.ts`: Line 157
  - `consultation-form.ts`: Lines 191, 215, 271, 365, 377, 414, 463
  - `main.ts`: Line 6

- **Native confirm() dialogs**: 4 instances that should use Modal component
  - `consultation-detail.ts:204` - Cancel appointment confirmation
  - `consultation-detail.ts:229` - Remove participant confirmation
  - `consultation-detail.ts:260` - Close consultation confirmation
  - `consultation-detail.ts:283` - Reopen consultation confirmation
  - `availability.ts:324` - Delete time slot confirmation

- **Missing lint script**: `package.json` doesn't have `"lint": "ng lint"` script defined

#### Architecture Gaps
- **No WebSocket Service**: Need centralized WebSocketService with:
  - Auto-reconnection logic
  - Connection state management
  - Message queuing for offline scenarios
  - Event subscription system

- **No Logging Service**: Console.log used directly instead of abstracted logging service

- **Error Handling**: No global error interceptor or centralized error handling strategy

### Backend Integration Status

#### API Endpoints (Fully Integrated) ✅
All REST API endpoints are implemented and working:
- Authentication: `/api/auth/login/`, `/api/auth/user/`
- Consultations: Full CRUD with appointments and participants
- Availability: Booking slots management
- User management: Profile, languages, specialities

#### Real-time Features
- **User WebSocket**: ✅ Fully integrated
  - `ws://host/ws/user/` - User notifications and status (CONNECTED)
- **Consultation WebSocket**: ✅ Fully integrated
  - `ws://host/ws/consultation/{id}/` - Real-time consultation updates (CONNECTED)
  - Real-time messages display
  - Participant join/leave toast notifications
  - Appointment update notifications

- **WebRTC Media**: Backend ready (Janus/LiveKit), frontend missing
  - No video call component
  - No media stream handling
  - No peer connection management

### Immediate Priorities

1. **Integrate WebRTC** - Enable video consultations (MAJOR FEATURE)
   - Create WebRTC service for peer connections
   - Build video call UI component
   - Connect "Join Consultation" button functionality
   - Handle ICE candidates and offer/answer exchange

2. **Complete Modal Component** - Replace native confirm() dialogs (5 instances)

3. **Build Dashboard** - Add statistics, recent activity, upcoming appointments

4. **Clean up unused components** - Remove or integrate accordion, checkbox, radio, etc.