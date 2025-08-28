.DEFAULT_GOAL := build

STATIC=/usr/share
VAR=/var
ETC=/etc
PROJECT=hcw
COMPONENT=practitioner

dist/practitioner/browser: node_modules
	npm run build

node_modules:
	npx yarn

install: dist/practitioner/browser
	mkdir -p $(DESTDIR)$(STATIC)/$(PROJECT)/$(COMPONENT)/
	cp -r dist/practitioner/browser/* $(DESTDIR)$(STATIC)/$(PROJECT)/$(COMPONENT)/

build: dist/practitioner/browser

clean:
	rm -rf dist node_modules
