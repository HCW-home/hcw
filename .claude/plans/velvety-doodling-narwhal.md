# Plan : Intégration des Custom Fields dans les Frontends

## Contexte

Le backend expose déjà :
- `GET /api/custom-fields/?target_model=...` — liste les champs personnalisés disponibles pour un modèle
- Les serializers Consultation, Request et HealthMetric retournent et acceptent `custom_fields` en lecture/écriture

Il faut maintenant intégrer ces custom fields dans le **practitioner** (formulaire consultation) et le **patient** (formulaire new-request, step review).

## Fichiers à modifier

### 1. Interfaces TypeScript — Modèle CustomField

**`practitioner/src/app/core/models/consultation.ts`**
- Ajouter `CustomField` interface : `{ id, name, field_type, target_model, required, options, ordering }`
- Ajouter `CustomFieldValue` interface : `{ field, field_name, field_type, value, options }`
- Ajouter `custom_fields?: CustomFieldValue[]` sur `Consultation`
- Ajouter `custom_fields?: CustomFieldValue[]` sur `ConsultationRequest`
- Ajouter `custom_fields?: { field: number, value: string }[]` sur `CreateConsultationRequest`

**`patient/src/app/core/models/consultation.model.ts`**
- Mêmes interfaces `CustomField`, `CustomFieldValue`
- Ajouter `custom_fields?: CustomFieldValue[]` sur `ConsultationRequest`
- Ajouter `custom_fields?: { field: number, value: string }[]` sur `CreateRequestPayload`

### 2. Services — Appel API getCustomFields

**`practitioner/src/app/core/services/consultation.service.ts`**
- Ajouter méthode `getCustomFields(targetModel: string): Observable<CustomField[]>` → `GET /api/custom-fields/?target_model=...`

**`patient/src/app/core/services/consultation.service.ts`**
- Ajouter méthode `getCustomFields(targetModel: string): Observable<CustomField[]>` → `GET /api/custom-fields/?target_model=...` (via `this.api.get`)

### 3. Practitioner — Consultation Form

**`practitioner/src/app/modules/user/components/consultation-form/consultation-form.ts`**
- Charger les custom fields au `ngOnInit` via `getCustomFields('consultations.Consultation')`
- Stocker dans `customFields = signal<CustomField[]>([])`
- Dans `initForm()`, après chargement des custom fields, ajouter un `FormGroup` `custom_fields` avec un control par champ (clé = field id, validators si required)
- En mode edit (`populateForm`), patcher les valeurs depuis `consultation.custom_fields`
- Dans `createConsultation()` et `updateConsultation()`, inclure `custom_fields: [{ field: id, value: val }, ...]` dans le payload

**`practitioner/src/app/modules/user/components/consultation-form/consultation-form.html`**
- Dans le step 0 (details), après le champ description, ajouter une section qui itère sur `customFields()` :
  - `short_text` → `<app-input>`
  - `long_text` → `<app-textarea>`
  - `date` → `<app-input type="date">`
  - `number` → `<app-input type="number">`
  - `list` → `<app-select>` avec options mappées depuis `field.options`

### 4. Patient — New Request Page

**`patient/src/app/pages/new-request/new-request.page.ts`**
- Charger les custom fields via `getCustomFields('consultations.Request')` quand on arrive au step 5 (review)
- Stocker dans `customFields = signal<CustomField[]>([])`
- Stocker les valeurs dans `customFieldValues = signal<Record<number, string>>({})`
- Dans `submitRequest()`, ajouter `custom_fields: Object.entries(customFieldValues()).map(...)` au payload

**`patient/src/app/pages/new-request/new-request.page.html`**
- Dans le step 5 (review), avant le comment-section, ajouter un bloc qui itère sur `customFields()` :
  - `short_text` → `<input type="text">` (Ionic style)
  - `long_text` → `<ion-textarea>`
  - `date` → `<input type="date">`
  - `number` → `<input type="number">`
  - `list` → `<select>` avec les options
  - Marquer les champs required visuellement

**`patient/src/app/pages/new-request/new-request.page.scss`**
- Styles pour la section custom fields (réutiliser le style des review-item/comment-section existants)

### 5. Traductions

**`practitioner/src/assets/i18n/en.json`**, **`fr.json`**, **`de.json`**
- Ajouter clé `consultationForm.customFields` : "Custom Fields" / "Champs personnalisés" / "Benutzerdefinierte Felder"

**`patient/src/assets/i18n/en.json`**, **`fr.json`**, **`de.json`**
- Ajouter clé `newRequest.additionalInfo` : "Additional Information" / "Informations complémentaires" / "Zusätzliche Informationen"

## Flux de données

### Practitioner — Consultation Form (create/edit)
1. `ngOnInit` → `getCustomFields('consultations.Consultation')` → stocke dans signal
2. Construit les FormControls dynamiques
3. En edit : `populateForm` patche les valeurs depuis `consultation.custom_fields`
4. Submit → inclut `custom_fields: [{field, value}, ...]` dans le payload POST/PATCH

### Patient — New Request (step 5)
1. Arrivée step 5 → `getCustomFields('consultations.Request')` → stocke dans signal
2. Affiche les champs avec binding `[(ngModel)]` sur `customFieldValues()`
3. Submit → inclut `custom_fields` dans le payload POST `/requests/`

## Vérification
1. Créer un custom field dans l'admin pour `consultations.Consultation` (ex: "Blood Type", short_text)
2. Créer un custom field pour `consultations.Request` (ex: "Priority", list avec options Low/Medium/High)
3. Practitioner : créer une consultation → le champ "Blood Type" apparaît dans le step Details → saisir une valeur → vérifier qu'elle est sauvegardée (GET consultation renvoie custom_fields)
4. Patient : créer une request → step Review affiche "Priority" → sélectionner une valeur → vérifier qu'elle est sauvegardée (GET request renvoie custom_fields)
5. Practitioner : éditer la consultation → la valeur est pré-remplie → modifier → vérifier la mise à jour
