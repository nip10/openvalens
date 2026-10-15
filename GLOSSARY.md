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

**Food catalog**:
An instance-wide, read-only mirror of one public food database (USDA FoodData
Central or Open Food Facts), kept in its own table with its own license and
attribution. It holds no personal data and is never merged with another
catalog or with a person's custom foods; logging copies a catalog food into a
snapshot.
_Avoid_: Food database (ambiguous), canonical foods table

**Nutrient coverage**:
For one nutrient on one local day, how many of the day's logged entries
provided a value (`full`, `partial`, `none`, or `no_entries` when nothing was
logged). A daily total sums only provided values and is always shown with its
coverage; a value a food's source did not provide is unknown, never zero.
_Avoid_: Completeness (that is the explicit "day complete" marker), data quality
