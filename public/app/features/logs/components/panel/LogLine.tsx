import { css } from '@emotion/css';
import { CSSProperties, useCallback, useEffect, useRef, useState } from 'react';
import tinycolor from 'tinycolor2';

import { GrafanaTheme2, LogsDedupStrategy } from '@grafana/data';
import { useTranslate } from '@grafana/i18n';
import { Button, Icon, Tooltip } from '@grafana/ui';

import { LOG_LINE_BODY_FIELD_NAME } from '../LogDetailsBody';
import { LogMessageAnsi } from '../LogMessageAnsi';

import { LogLineMenu } from './LogLineMenu';
import { useLogIsPinned, useLogListContext } from './LogListContext';
import { LogListModel } from './processing';
import {
  FIELD_GAP_MULTIPLIER,
  hasUnderOrOverflow,
  getLineHeight,
  LogFieldDimension,
  TRUNCATION_LINE_COUNT,
} from './virtualization';

export interface Props {
  displayedFields: string[];
  index: number;
  log: LogListModel;
  showTime: boolean;
  style: CSSProperties;
  styles: LogLineStyles;
  onClick: (log: LogListModel) => void;
  onOverflow?: (index: number, id: string, height?: number) => void;
  variant?: 'infinite-scroll';
  wrapLogMessage: boolean;
}

export const LogLine = ({
  displayedFields,
  index,
  log,
  style,
  styles,
  onClick,
  onOverflow,
  showTime,
  variant,
  wrapLogMessage,
}: Props) => {
  const { detailsDisplayed, onLogLineHover } = useLogListContext();
  const [collapsed, setCollapsed] = useState<boolean | undefined>(
    wrapLogMessage && log.collapsed !== undefined ? log.collapsed : undefined
  );
  const logLineRef = useRef<HTMLDivElement | null>(null);
  const pinned = useLogIsPinned(log);

  useEffect(() => {
    if (!onOverflow || !logLineRef.current) {
      return;
    }
    const calculatedHeight = typeof style.height === 'number' ? style.height : undefined;
    const actualHeight = hasUnderOrOverflow(logLineRef.current, calculatedHeight, log.collapsed);
    if (actualHeight) {
      onOverflow(index, log.uid, actualHeight);
    }
  });

  useEffect(() => {
    if (!wrapLogMessage) {
      setCollapsed(undefined);
    } else if (collapsed === undefined && log.collapsed !== undefined) {
      setCollapsed(log.collapsed);
    } else if (collapsed !== undefined && log.collapsed === undefined) {
      setCollapsed(log.collapsed);
    }
  }, [collapsed, log.collapsed, wrapLogMessage]);

  const handleMouseOver = useCallback(() => onLogLineHover?.(log), [log, onLogLineHover]);

  const handleExpandCollapse = useCallback(() => {
    const newState = !collapsed;
    setCollapsed(newState);
    log.setCollapsedState(newState);
    onOverflow?.(index, log.uid);
  }, [collapsed, index, log, onOverflow]);

  const { t } = useTranslate();
  const handleClick = useCallback(() => {
    onClick(log);
  }, [log, onClick]);

  const detailsShown = detailsDisplayed(log);

  return (
    <div style={style}>
      <div
        className={`${styles.logLine} ${variant ?? ''} ${pinned ? styles.pinnedLogLine : ''} ${detailsShown ? styles.detailsDisplayed : ''}`}
        ref={onOverflow ? logLineRef : undefined}
        onMouseEnter={handleMouseOver}
        onFocus={handleMouseOver}
      >
        <LogLineMenu styles={styles} log={log} />
        {/* A button element could be used but in Safari it prevents text selection. Fallback available for a11y in LogLineMenu  */}
        {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events */}
        <div
          className={`${wrapLogMessage ? styles.wrappedLogLine : `${styles.unwrappedLogLine} unwrapped-log-line`} ${collapsed === true ? styles.collapsedLogLine : ''}`}
          onClick={handleClick}
        >
          <Log
            displayedFields={displayedFields}
            log={log}
            showTime={showTime}
            styles={styles}
            wrapLogMessage={wrapLogMessage}
          />
        </div>
      </div>
      {collapsed === true && (
        <div className={styles.expandCollapseControl}>
          <Button
            variant="primary"
            fill="text"
            size="sm"
            className={styles.expandCollapseControlButton}
            onClick={handleExpandCollapse}
          >
            {t('logs.log-line.show-more', 'show more')}
          </Button>
        </div>
      )}
      {collapsed === false && (
        <div className={styles.expandCollapseControl}>
          <Button
            variant="primary"
            fill="text"
            size="sm"
            className={styles.expandCollapseControlButton}
            onClick={handleExpandCollapse}
          >
            {t('logs.log-line.show-less', 'show less')}
          </Button>
        </div>
      )}
    </div>
  );
};

interface LogProps {
  displayedFields: string[];
  log: LogListModel;
  showTime: boolean;
  styles: LogLineStyles;
  wrapLogMessage: boolean;
}

const Log = ({ displayedFields, log, showTime, styles, wrapLogMessage }: LogProps) => {
  const { dedupStrategy } = useLogListContext();
  const { t } = useTranslate();
  return (
    <>
      {dedupStrategy !== LogsDedupStrategy.none && (
        <span className={`${styles.duplicates} field`}>
          {log.duplicates && log.duplicates > 0 ? `${log.duplicates + 1}x` : null}
        </span>
      )}
      {log.hasError && (
        <span className={`${styles.hasError} field`}>
          <Tooltip
            content={t('logs.log-line.tooltip-error', 'Error: {{errorMessage}}', { errorMessage: log.errorMessage })}
            placement="right"
            theme="error"
          >
            <Icon
              className={styles.logIconError}
              name="exclamation-triangle"
              aria-label={t('logs.log-line.has-error', 'Has errors')}
              size="xs"
            />
          </Tooltip>
        </span>
      )}
      {log.isSampled && (
        <span className={`${styles.isSampled} field`}>
          <Tooltip content={log.sampledMessage ?? ''} placement="right" theme="info">
            <Icon
              className={styles.logIconInfo}
              name="info-circle"
              size="xs"
              aria-label={t('logs.log-line.is-sampled', 'Is sampled')}
            />
          </Tooltip>
        </span>
      )}
      {showTime && <span className={`${styles.timestamp} level-${log.logLevel} field`}>{log.timestamp}</span>}
      {
        // When logs are unwrapped, we want an empty column space to align with other log lines.
      }
      {(log.displayLevel || !wrapLogMessage) && (
        <span className={`${styles.level} level-${log.logLevel} field`}>{log.displayLevel}</span>
      )}
      {displayedFields.length > 0 ? (
        displayedFields.map((field) =>
          field === LOG_LINE_BODY_FIELD_NAME ? (
            <LogLineBody log={log} key={field} />
          ) : (
            <span className="field" title={field} key={field}>
              {log.getDisplayedFieldValue(field)}
            </span>
          )
        )
      ) : (
        <LogLineBody log={log} />
      )}
    </>
  );
};

const LogLineBody = ({ log }: { log: LogListModel }) => {
  const { syntaxHighlighting } = useLogListContext();

  if (log.hasAnsi) {
    const needsHighlighter =
      log.searchWords && log.searchWords.length > 0 && log.searchWords[0] && log.searchWords[0].length > 0;
    const highlight = needsHighlighter ? { searchWords: log.searchWords ?? [], highlightClassName: '' } : undefined;
    return (
      <span className="field no-highlighting">
        <LogMessageAnsi value={log.body} highlight={highlight} />
      </span>
    );
  }

  if (!syntaxHighlighting) {
    return <span className="field no-highlighting">{log.body}</span>;
  }

  return <span className="field log-syntax-highlight" dangerouslySetInnerHTML={{ __html: log.highlightedBody }} />;
};

export function getGridTemplateColumns(dimensions: LogFieldDimension[]) {
  const columns = dimensions.map((dimension) => dimension.width).join('px ');
  return `${columns}px 1fr`;
}

export type LogLineStyles = ReturnType<typeof getStyles>;
export const getStyles = (theme: GrafanaTheme2) => {
  const colors = {
    critical: '#B877D9',
    error: theme.colors.error.text,
    warning: '#FBAD37',
    debug: '#6E9FFF',
    trace: '#6ed0e0',
    info: '#6CCF8E',
    metadata: theme.colors.text.primary,
    parsedField: theme.colors.text.primary,
  };

  return {
    logLine: css({
      color: tinycolor(theme.colors.text.secondary).setAlpha(0.75).toRgbString(),
      display: 'flex',
      gap: theme.spacing(0.5),
      flexDirection: 'row',
      fontFamily: theme.typography.fontFamilyMonospace,
      fontSize: theme.typography.fontSize,
      wordBreak: 'break-all',
      '&:hover': {
        background: `hsla(0, 0%, 0%, 0.2)`,
      },
      '&.infinite-scroll': {
        '&::before': {
          borderTop: `solid 1px ${theme.colors.border.strong}`,
          content: '""',
          height: 0,
          left: 0,
          position: 'absolute',
          top: -3,
          width: '100%',
        },
      },
      '& .log-syntax-highlight': {
        '.log-token-string': {
          color: tinycolor(theme.colors.text.secondary).setAlpha(0.75).toRgbString(),
        },
        '.log-token-duration': {
          color: theme.colors.success.text,
        },
        '.log-token-size': {
          color: theme.colors.success.text,
        },
        '.log-token-uuid': {
          color: theme.colors.success.text,
        },
        '.log-token-key': {
          color: colors.parsedField,
          opacity: 0.9,
          fontWeight: theme.typography.fontWeightMedium,
        },
        '.log-token-json-key': {
          color: colors.parsedField,
          opacity: 0.9,
          fontWeight: theme.typography.fontWeightMedium,
        },
        '.log-token-label': {
          color: colors.metadata,
          fontWeight: theme.typography.fontWeightBold,
        },
        '.log-token-method': {
          color: theme.colors.info.shade,
        },
      },
      '& .no-highlighting': {
        color: theme.colors.text.primary,
      },
    }),
    detailsDisplayed: css({
      background: `hsla(0, 0%, 0%, 0.2)`,
    }),
    pinnedLogLine: css({
      backgroundColor: tinycolor(theme.colors.info.transparent).setAlpha(0.25).toString(),
    }),
    menuIcon: css({
      height: getLineHeight(),
      margin: 0,
      padding: theme.spacing(0, 0, 0, 0.5),
    }),
    logLineMessage: css({
      fontFamily: theme.typography.fontFamily,
      justifyContent: 'center',
    }),
    timestamp: css({
      color: theme.colors.text.disabled,
      display: 'inline-block',
    }),
    duplicates: css({
      display: 'inline-block',
      textAlign: 'center',
      width: theme.spacing(4.5),
    }),
    hasError: css({
      display: 'inline-block',
      width: theme.spacing(2),
      '& svg': {
        position: 'relative',
        top: -1,
      },
    }),
    isSampled: css({
      display: 'inline-block',
      width: theme.spacing(2),
      '& svg': {
        position: 'relative',
        top: -1,
      },
    }),
    logIconError: css({
      color: theme.colors.warning.main,
    }),
    logIconInfo: css({
      color: theme.colors.info.main,
    }),
    level: css({
      color: theme.colors.text.secondary,
      fontWeight: theme.typography.fontWeightBold,
      textTransform: 'uppercase',
      display: 'inline-block',
      '&.level-critical': {
        color: colors.critical,
      },
      '&.level-error': {
        color: colors.error,
      },
      '&.level-warning': {
        color: colors.warning,
      },
      '&.level-info': {
        color: colors.info,
      },
      '&.level-debug': {
        color: colors.debug,
      },
    }),
    loadMoreButton: css({
      background: 'transparent',
      border: 'none',
      display: 'inline',
    }),
    overflows: css({
      outline: 'solid 1px red',
    }),
    unwrappedLogLine: css({
      cursor: 'pointer',
      display: 'grid',
      gridColumnGap: theme.spacing(FIELD_GAP_MULTIPLIER),
      whiteSpace: 'pre',
      paddingBottom: theme.spacing(0.75),
    }),
    wrappedLogLine: css({
      cursor: 'pointer',
      alignSelf: 'flex-start',
      paddingBottom: theme.spacing(0.75),
      whiteSpace: 'pre-wrap',
      '& .field': {
        marginRight: theme.spacing(FIELD_GAP_MULTIPLIER),
      },
      '& .field:last-child': {
        marginRight: 0,
      },
    }),
    collapsedLogLine: css({
      maxHeight: `${TRUNCATION_LINE_COUNT * getLineHeight()}px`,
      overflow: 'hidden',
    }),
    expandCollapseControl: css({
      display: 'flex',
      justifyContent: 'center',
    }),
    expandCollapseControlButton: css({
      fontWeight: theme.typography.fontWeightLight,
      height: getLineHeight(),
      margin: 0,
    }),
  };
};
