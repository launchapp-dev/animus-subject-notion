# animus-subject-notion

Notion page subject backend for Animus, backed by a Notion data source or
database.

## Install

```bash
animus plugin install launchapp-dev/animus-subject-notion --signature-policy strict
```

## Configuration

Required environment:

- `NOTION_TOKEN`
- `NOTION_DATA_SOURCE_ID` (`NOTION_DATABASE_ID` is accepted as an alias)

Optional environment:

- `NOTION_PARENT_TYPE` defaults to `data_source`; set `database` for older
  Notion database query/create paths.
- `NOTION_VERSION` defaults to `2025-09-03`.
- `NOTION_TITLE_PROPERTY` defaults to `Name`.
- `NOTION_STATUS_PROPERTY` defaults to `Status`.
- `NOTION_LABELS_PROPERTY` defaults to `Tags`.
- `NOTION_DESCRIPTION_PROPERTY` defaults to `Description`.
- `NOTION_ASSIGNEE_PROPERTY` defaults to `Assignee`.
- `NOTION_READY_STATUS`, `NOTION_IN_PROGRESS_STATUS`, `NOTION_BLOCKED_STATUS`,
  `NOTION_DONE_STATUS`, and `NOTION_CANCELLED_STATUS` customize native status
  names.

## Subject Kind

This plugin serves `notion.page` subjects. Subject ids are shaped as:

```text
notion.page:2f1e...
```

The plugin reads common Notion property types (`title`, `rich_text`, `status`,
`select`, `multi_select`, `people`, and `checkbox`) and writes configurable
title, status, labels, description, and assignee properties.
