subdirs = backend practitioner patient

.PHONY: $(subdirs)

install: $(subdirs)
clean: $(subdirs)
build: $(subdirs)

$(subdirs):
	make -C $@ $(MAKECMDGOALS)
