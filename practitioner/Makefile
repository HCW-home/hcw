.DEFAULT_GOAL := build

STATIC=/usr/share
VAR=/var
ETC=/etc
PROJECT=jhas
COMPONENT=frontend

dist/practitioner/browser: node_modules
	npm run build

node_modules:
	npm i

install: dist/practitioner/browser
	mkdir -p $(DESTDIR)$(STATIC)/$(PROJECT)/$(COMPONENT)/
	cp -r dist/* $(DESTDIR)$(STATIC)/$(PROJECT)/$(COMPONENT)/

build: dist/practitioner/browser

clean:
	rm -rf dist node_modules
