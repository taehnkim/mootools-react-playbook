---
name: mootools-callsite-inventory
description: Finds every legacy load path and construction site for one MooTools component, then plans and verifies the adapter rewrite. Use while analyzing a MooTools component and before applying its React migration adapter.
---

# Inventory MooTools call sites

Use this skill during `mootools-react-migrate`. Finish the inventory before
you write the adapter or change a caller.

The examples in this skill are external examples. They are not files in this
repository. Use them only as examples of loading patterns.

## What counts as a call site

Do not search only for JavaScript `import` statements. Legacy MooTools code can
make a component available without a module import.

Inventory both parts of the path:

1. A load site makes the class file available to the page.
2. A construction site runs `new Component(...)` or calls code that does.

The same component can have many load sites and many construction sites. Find
all of them. The migration is incomplete if one page can still construct the
component without the feature-flagged adapter.

## Search procedure

Start with the component class name, its source filename, its public global
name, and known aliases. Search JavaScript, PHP, HTML templates, and template
JavaScript.

Then search the loading mechanisms from the pattern list below:

- literal `<script src>` tags;
- `buildJS()` with a filename or an inline code string;
- `.tpl.js` files returned by `Template::getTemplate(...)`;
- automatic `/js/{route}.js` loading;
- `loadJS()`;
- `Asset.javascript(...)`;
- inline `<script>` blocks and HTML event attributes.

Trace generated code. If PHP or a template returns JavaScript, follow the value
to the place that adds it to the page. Do not stop at the first text match.

For each result, record:

- file and line;
- load site or construction site;
- how the page reaches it;
- component filename or constructor name;
- arguments, DOM target, and expected return value;
- script order, callback, or runtime timing requirements;
- planned adapter change;
- verification page or scenario.

## Loading and construction patterns

### 0. Global header or layout

A shared header can load MooTools and a component on every page:

External example: `header.tpl.html`, lines 34-37.

```html
<script type="text/javascript" src="/core/js/mootoolsCore.js?ver={JS_VER}"></script>
<script type="text/javascript" src="/core/js/mootoolsMore.js?ver={JS_VER}"></script>
<script type="text/javascript" src="/core/js/mootools-crm-compat.js?ver={JS_VER}"></script>
```

Always-on helpers can appear in the same header:

External example: `header.tpl.html`, line 57.

```html
<script type="text/javascript" src="/core/js/autocomplete.class.js?ver={JS_VER}"></script>
```

PHP can also append a global loader:

External example: `BaseTemplate.class.php`, line 404.

```php
$headJS .= '<script id="loadDialogJS" src="/core/js/mooDialogLoader.js?ver='.JS_VER.'" type="text/javascript"></script>';
```

Check the shared header and PHP that adds scripts to it. Preserve MooTools
core, MooTools More, compatibility code, and component dependency order. Make
the adapter available before any construction site runs. Keep the legacy
implementation available when the feature flag selects it.

### 1. Inline script in a `.tpl.html` file

External example: `templates/admin/merge_advisor_profiles.tpl.html`.

```html
<script>
  var keepAC = new AutoComplete(...);
</script>
```

This is both generated page code and a construction site. Replace the direct
constructor with the adapter. Preserve its arguments, assignment, execution
time, and return value.

### 2. PHP `buildJS()` with a file

External examples: `Home.php` and `Compliance.php`.

```php
$TPL->buildJS('/core/js/plugins/chosen.mootools.js', true);
```

Treat the requested file as a load site. Inspect that file for component
definitions and constructions. Preserve the `buildJS()` options and load
order when the adapter becomes the file that callers load.

### 2b. PHP `buildJS()` with an inline code string

External example: `Advisors.html.php`.

```php
$TPL->buildJS("MainAPI.setupAutoComplete('AdvisorId', { dataSrc : {url: '/findUniqueObjectByNameOrID/advisor/'}, ...});", false, true);
```

Treat the string as executable JavaScript. Trace helper calls such as
`setupAutoComplete` to the constructor they reach. Rewrite the direct
constructor behind that helper, or route the helper through the adapter.
Preserve PHP and JavaScript string escaping.

### 3. `.tpl.js` construction

External example: `client_org_compliance_grid_edit.tpl.js`, line 1.

```javascript
new TabPane('ComplianceQuestionInsertAfterElement', {'contentSelector': '.tabContent'});
```

The `.tpl.js` file can be returned by `Template::getTemplate(...)` and then
passed to `buildJS()`. Trace both steps. Replace the direct constructor with
the adapter and preserve the target and options.

### 4. Automatic page script by route name

External example: `BaseTemplate` loads `/js/{component}.js` when the file
exists. A `requests` route can load `/js/requests.js`, which can construct
`AutoComplete` or `MooDialog`.

Map the route to its page script, then inspect the script. The automatic
loader is a load site. Each constructor in the page script is a separate
construction site.

### 5. `loadJS()` runtime injection

External examples: `main.js`, a browse template, and `advisorSearch.js`.

```javascript
loadJS({ file: "/js/requestSearch.js" });
loadJS({ file: "/core/js/autocomplete.class.js" });
```

Runtime injection is order-sensitive. Inspect the loaded file and its callers.
Route the load through the adapter without changing when dependent code can
run. Preserve callbacks or completion behavior if the real call has them.

### 6. `Asset.javascript(...)` direct MooTools loader

External example: `clients.js`, lines 5-9.

```javascript
Asset.javascript('/core/js/moodialog/MooDialog.js', {
    onLoad: function () {
        Asset.javascript('/core/js/moodialog/MooDialog.Alert.js');
        Asset.javascript('/core/js/moodialog/MooDialog.Confirm.js');
    }
});
```

Treat each nested load as a load site. Preserve `onLoad` order. The adapter
must not report the component as ready before the selected implementation and
its dependencies are ready.

### 7. Inline HTML event attributes

External example: `event_client_filter_row.tpl.html`.

```html
onkeypress="new AutoComplete(this, { typeID: 'Client', ... })"
```

Inline event code needs a browser global. Route it through the global adapter.
Preserve `this`, the event timing, arguments, and any return value that controls
the browser event.

## Rewrite rules

Build one adapter plan that covers every inventory row.

- Route every construction site through the component adapter.
- Let the adapter read the feature flag and select the legacy or React
  implementation.
- Do not call the React component or mount directly from a legacy caller.
- Make the adapter available through every required load path before callers
  run.
- Preserve the legacy class and its dependencies for the legacy flag value.
- Preserve script order, callbacks, assignments, globals, arguments, and return
  behavior.
- Do not partially rewrite the inventory.

If the adapter transform cannot safely handle PHP, templates, strings, dynamic
loaders, or event attributes, stop the write. Add a focused transform and test
for that pattern, then rerun the complete adapter plan.

## Completion check

After the rewrite, repeat the searches for the class name, source filename,
global name, aliases, and every loading mechanism.

Every remaining direct legacy reference must be one of these:

- the legacy implementation selected by the adapter;
- a focused legacy test;
- an approved and recorded exception.

List the complete call-site inventory and the status of each row in the draft
PR. Do not claim completion while an unexplained load or construction site
remains.

## Short map

```text
Load class file      -> header | buildJS(file) | loadJS |
                        Asset.javascript | automatic /js/{route}.js
Construct instance   -> tpl.html script | tpl.js | buildJS(code) |
                        page JavaScript | HTML on*
```
