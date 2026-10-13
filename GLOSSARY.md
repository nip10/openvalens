# OpenValens

OpenValens is a personal health record platform where each person works inside
their own workspace. This glossary fixes the two authority concepts that the
global settings foundation depends on.

## Language

**Instance administrator**:
An operator with explicit authority over the whole OpenValens installation. The
authority is granted deliberately by a trusted operator and is never implied by
membership in, or ownership of, any single workspace.
_Avoid_: Global admin, superuser, system administrator

**Workspace owner**:
The person who owns a workspace and holds full authority within it. Workspace
ownership is scoped to that one workspace and never confers instance
administrator authority.
_Avoid_: Organization owner, account owner, org admin
