#!/usr/bin/env bash
# Prepare the official ALIGN 1.0 (8) iOS project on the owner's Mac.
# No GitHub mutation, App Store upload, certificate change or deployment.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "Abre este terminal desde el repositorio align-community en GitHub Desktop."
  exit 1
}
cd "$ROOT"

EXPECTED_BRANCH="feature/align-ios-native-app-20261012"
CURRENT_BRANCH="$(git branch --show-current)"
if [[ "$CURRENT_BRANCH" != "$EXPECTED_BRANCH" ]]; then
  echo "Rama incorrecta: $CURRENT_BRANCH"
  echo "Debes seleccionar $EXPECTED_BRANCH antes de preparar el archivo oficial."
  exit 1
fi

if [[ -n "$(git status --porcelain -- ios/ALIGN/Sources ios/ALIGN/project.yml)" ]]; then
  echo "Hay cambios locales de codigo/configuracion de iOS. No se sobrescribio ninguno."
  echo "Revisa git status antes de continuar."
  exit 1
fi

PROJECT="ios/ALIGN/project.yml"
grep -Fq 'PRODUCT_BUNDLE_IDENTIFIER: mx.com.alignmembers.app' "$PROJECT" || {
  echo "Falta el Bundle ID oficial de ALIGN."; exit 1;
}
grep -Fq 'MARKETING_VERSION: "1.0"' "$PROJECT" || {
  echo "La configuracion oficial no marca version 1.0."; exit 1;
}
grep -Fq 'CURRENT_PROJECT_VERSION: "8"' "$PROJECT" || {
  echo "La configuracion oficial no contiene build 8."; exit 1;
}

command -v xcodegen >/dev/null || {
  echo "Falta XcodeGen: ejecuta brew install xcodegen y vuelve a intentar."
  exit 1
}
command -v xcodebuild >/dev/null || {
  echo "Falta Xcode completo: instala Xcode y selecciona su carpeta Developer."
  exit 1
}

echo "Verificando Xcode:"
xcodebuild -version

echo "Generando icono oficial de ALIGN..."
swift ios/ALIGN/scripts/generate-app-icon.swift \
  ios/ALIGN/assets/approved-icon.b64 \
  ios/ALIGN/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png

echo "Generando proyecto Xcode..."
(
  cd ios/ALIGN
  xcodegen generate
)

echo "Abriendo ALIGN oficial en Xcode..."
open ios/ALIGN/ALIGN.xcodeproj

echo "Preparacion terminada. En Xcode: Scheme ALIGN; Archive Release; version 1.0; build 8."
echo "No selecciones ALIGN Private TestFlight. El upload requiere firma Apple en Xcode."
