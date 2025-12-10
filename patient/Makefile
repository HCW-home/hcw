.DEFAULT_GOAL := build

STATIC=/usr/share
VAR=/var
ETC=/etc
PROJECT=hcw
COMPONENT=patient

www: node_modules
	npm run build

node_modules:
	npm i

install: www
	mkdir -p $(DESTDIR)$(STATIC)/$(PROJECT)/$(COMPONENT)/
	cp -r www/* $(DESTDIR)$(STATIC)/$(PROJECT)/$(COMPONENT)/

build: www

clean:
	rm -rf www node_modules
