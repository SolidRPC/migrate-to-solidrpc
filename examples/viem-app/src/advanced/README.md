# Advanced dual route

This directory is an explicit opt-in example for a user who requests a runtime-selectable
dual route. It is not exported by the sample barrel or invoked by a package script.

Invalid, missing, edited, or expired evidence disables only the SolidRPC candidate. The
existing rollback route remains selected, so evidence failure cannot cause a total RPC
outage. The normal migration does not use this module, HMAC evidence, files, expiry gates,
or a runtime selector.
