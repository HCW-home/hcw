from unfold.widgets import UnfoldAdminTextInputWidget


class UnfoldColorInputWidget(UnfoldAdminTextInputWidget):
    """Native HTML5 color picker, styled to match Unfold's text inputs.

    Used by Constance color settings (e.g. the calendar rotation colors) so the
    operator gets a swatch picker in the admin instead of a raw hex text field.
    """

    input_type = "color"
