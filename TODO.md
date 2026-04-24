
* Add validation on phone number

## Top priority

- patient will be redirected to patient app if login in doctor app

Feedback Gilles
===============

- image cannot be svg
- http://localhost:8001/new-request > validation synchrone ?

- Tableau on comprend pas cliquable

Controle pendant l'appel pas clair
==================================

Il faudrait ajouter des petits labels à droite des boutons.

Ajouter icone spécialisé
========================

Ajoute une icone personnalisé pour la spécialité (paramétrable dans l'admin), visible par le patient dans http://localhost:8001/new-request

Système de notification browser pour patient
============================================

Le patient ne semble pas avoir les notifications browser comme pour les practitioner. Il faut l'ajouter.

Améliorations responsable (à réfléchir)
=======================================

http://localhost:4200/app/dashboard

Tri en premier les consultations sans responsable, ajoute un label "Pas de responsable" en rouge.

Gestion des disponibilités
==========================

Dans ce projet, le médecin peut configurer ses disponibilités http://localhost:4200/app/availability
Néanmoins, je souhaite lui mettre un message en rouge lorsque ses disponibité ne sont pas utilisable (juste un warning)
> Lorsqu'aucune reason n'a pas été paramétré par l'admin
> Lorsque seul des raisons de type assignation spécialité sont défini, mais que le médecin n'est pas dans cette spécialité
