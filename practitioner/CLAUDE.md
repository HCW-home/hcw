# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

- **Start development server**: `ng serve` (serves at http://localhost:4200)
- **Build application**: `ng build` (outputs to dist/)
- **Run tests**: `ng test` (uses Karma + Jasmine)
- **Lint code**: `ng lint` (uses Angular ESLint)
- **Generate components**: `ng generate component component-name`
- **Watch build**: `ng build --watch --configuration development`

## Project Architecture

This is an Angular 20 application with a modular architecture:

### Core Structure
- **Core Module** (`src/app/core/`): Contains shared services, guards, constants, and models
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
- **google-libphonenumber**: Phone number validation
- **ESLint**: Code linting with Angular-specific rules
- **Prettier**: Code formatting

### Testing
- Karma + Jasmine for unit tests
- Test files follow `*.spec.ts` convention

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

### Usage Guidelines
1. **Import directly**: All components are standalone, import them directly in your component
2. **Form integration**: Form components implement ControlValueAccessor for seamless reactive forms
3. **Typography**: Use `TypographyTypeEnum` constants for consistent text styling
4. **Icons**: Reference SVG files from `public/svg/` directory in `<app-svg src="icon-name">`
5. **Validation**: Use `invalid` and `invalidMessage` inputs on form components