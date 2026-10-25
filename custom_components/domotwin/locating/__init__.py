"""DomoTwin's own Bluetooth locating (docs/DECISIONS.md, D-035).

Which room a phone, a watch or a tag is in, from what Home Assistant's Bluetooth receivers hear of
it: a signal model started from the plan (distances, walls, storeys), sharpened by what is learned
as people live, and a filter that follows the doors between rooms. Each module but `radio_ha` and
`locator` is pure: no Home Assistant objects.
"""
