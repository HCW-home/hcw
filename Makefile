subdirs = backend

.PHONY: $(subdirs)

install: $(subdirs)
clean: $(subdirs)
build: $(subdirs)

$(subdirs):
	make -C $@ $(MAKECMDGOALS)
