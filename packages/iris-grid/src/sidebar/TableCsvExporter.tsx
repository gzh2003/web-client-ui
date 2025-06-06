import React, { Component, type ReactElement } from 'react';
import ClassNames from 'classnames';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  Button,
  Checkbox,
  LoadingSpinner,
  RadioGroup,
  Radio,
  NumberField,
  Picker,
  Item,
  type ItemKey,
} from '@deephaven/components';
import {
  GridRange,
  GridUtils,
  type ModelSizeMap,
  type MoveOperation,
} from '@deephaven/grid';
import { vsWarning } from '@deephaven/icons';
import type { dh as DhType } from '@deephaven/jsapi-types';
import { TimeUtils } from '@deephaven/utils';
import { nanoid } from 'nanoid';
import './TableCsvExporter.scss';
import Log from '@deephaven/log';
import type IrisGridModel from '../IrisGridModel';
import IrisGridUtils from '../IrisGridUtils';

const log = Log.module('TableCsvExporter');
interface TableCsvExporterProps {
  model: IrisGridModel;
  name: string;
  userColumnWidths: ModelSizeMap;
  movedColumns: readonly MoveOperation[];
  isDownloading: boolean;
  tableDownloadStatus: string;
  tableDownloadProgress: number;
  tableDownloadEstimatedTime: number;
  onDownloadStart: () => void;
  onDownload: (
    fileName: string,
    frozenTable: DhType.Table,
    tableSubscription: DhType.TableViewportSubscription,
    snapshotRanges: readonly GridRange[],
    modelRanges: readonly GridRange[],
    includeColumnHeaders: boolean,
    useUnformattedValues: boolean
  ) => void;
  onCancel: () => void;
  selectedRanges: readonly GridRange[];
}

interface TableCsvExporterState {
  fileName: string;

  downloadRowOption: string;
  customizedDownloadRowOption: string;
  customizedDownloadRows: number;

  includeColumnHeaders: boolean;
  includeHiddenColumns: boolean;
  useUnformattedValues: boolean;

  errorMessage: React.ReactNode;
  id: string;
}
class TableCsvExporter extends Component<
  TableCsvExporterProps,
  TableCsvExporterState
> {
  static FILENAME_DATE_FORMAT = 'yyyy-MM-dd-HHmmss';

  static DOWNLOAD_STATUS = {
    INITIATING: 'INITIATING',
    DOWNLOADING: 'DOWNLOADING',
    FINISHED: 'FINISHED',
    CANCELED: 'CANCELED',
  };

  static DOWNLOAD_ROW_OPTIONS = {
    ALL_ROWS: 'ALL_ROWS',
    SELECTED_ROWS: 'SELECTED_ROWS',
    CUSTOMIZED_ROWS: 'CUSTOMIZED_ROWS',
  };

  static CUSTOMIZED_ROWS_OPTIONS = {
    FIRST: 'FIRST',
    LAST: 'LAST',
  };

  static DEFAULT_DOWNLOAD_ROWS = 100;

  static defaultProps = {
    onDownloadStart: (): void => undefined,
    isDownloading: false,
    tableDownloadStatus: '',
    tableDownloadProgress: 0,
    tableDownloadEstimatedTime: null,
    selectedRanges: [],
  };

  static getDateString(dh: typeof DhType): string {
    return dh.i18n.DateTimeFormat.format(
      TableCsvExporter.FILENAME_DATE_FORMAT,
      new Date()
    );
  }

  constructor(props: TableCsvExporterProps) {
    super(props);

    this.handleDownloadClick = this.handleDownloadClick.bind(this);
    this.handleDownloadRowOptionChanged =
      this.handleDownloadRowOptionChanged.bind(this);
    this.handleCustomizedDownloadRowOptionChanged =
      this.handleCustomizedDownloadRowOptionChanged.bind(this);
    this.handleCustomizedDownloadRowsChanged =
      this.handleCustomizedDownloadRowsChanged.bind(this);
    this.handleIncludeColumnHeadersChanged =
      this.handleIncludeColumnHeadersChanged.bind(this);
    this.handleIncludeHiddenColumnsChanged =
      this.handleIncludeHiddenColumnsChanged.bind(this);
    this.handleUseUnformattedValuesChanged =
      this.handleUseUnformattedValuesChanged.bind(this);

    const { model, name } = props;
    this.state = {
      fileName: `${name}-${TableCsvExporter.getDateString(model.dh)}.csv`,

      downloadRowOption: TableCsvExporter.DOWNLOAD_ROW_OPTIONS.ALL_ROWS,
      customizedDownloadRowOption:
        TableCsvExporter.CUSTOMIZED_ROWS_OPTIONS.FIRST,
      customizedDownloadRows: TableCsvExporter.DEFAULT_DOWNLOAD_ROWS,

      includeColumnHeaders: true,
      includeHiddenColumns: false,
      useUnformattedValues: false,

      errorMessage: null,
      id: nanoid(),
    };
  }

  getSnapshotRanges(): GridRange[] {
    const { model, selectedRanges } = this.props;
    const {
      downloadRowOption,
      customizedDownloadRowOption,
      customizedDownloadRows,
    } = this.state;
    const { rowCount, columnCount } = model;
    let snapshotRanges = [] as GridRange[];
    switch (downloadRowOption) {
      case TableCsvExporter.DOWNLOAD_ROW_OPTIONS.ALL_ROWS:
        snapshotRanges.push(new GridRange(0, 0, columnCount - 1, rowCount - 1));
        break;
      case TableCsvExporter.DOWNLOAD_ROW_OPTIONS.SELECTED_ROWS:
        snapshotRanges = selectedRanges
          .map(range => ({
            ...range,
            startColumn: 0,
            endColumn: columnCount - 1,
          }))
          .sort((rangeA, rangeB) => {
            if (rangeA.startRow != null && rangeB.startRow != null) {
              return rangeA.startRow - rangeB.startRow;
            }
            return 0;
          }) as GridRange[];
        break;
      case TableCsvExporter.DOWNLOAD_ROW_OPTIONS.CUSTOMIZED_ROWS:
        switch (customizedDownloadRowOption) {
          case TableCsvExporter.CUSTOMIZED_ROWS_OPTIONS.FIRST:
            snapshotRanges.push(
              new GridRange(
                0,
                0,
                columnCount - 1,
                Math.min(customizedDownloadRows - 1, rowCount - 1)
              )
            );
            break;
          case TableCsvExporter.CUSTOMIZED_ROWS_OPTIONS.LAST:
            snapshotRanges.push(
              new GridRange(
                0,
                Math.max(0, rowCount - customizedDownloadRows),
                columnCount - 1,
                rowCount - 1
              )
            );
            break;
          default:
            break;
        }
        break;
      default:
        break;
    }
    return snapshotRanges;
  }

  getModelRanges(ranges: readonly GridRange[]): GridRange[] {
    const { userColumnWidths, movedColumns } = this.props;
    const { includeHiddenColumns } = this.state;
    const hiddenColumns = IrisGridUtils.getHiddenColumns(userColumnWidths);
    let modelRanges = GridUtils.getModelRanges(ranges, movedColumns);
    if (!includeHiddenColumns && hiddenColumns.length > 0) {
      const subtractRanges = hiddenColumns.map(GridRange.makeColumn);
      modelRanges = GridRange.subtractRangesFromRanges(
        modelRanges,
        subtractRanges
      );
    }
    return modelRanges;
  }

  resetDownloadState(): void {
    this.setState({ errorMessage: null });
  }

  async handleDownloadClick(): Promise<void> {
    const { model, isDownloading, onDownloadStart, onDownload, onCancel } =
      this.props;
    const { fileName, includeColumnHeaders, useUnformattedValues } = this.state;

    if (isDownloading) {
      onCancel();
      return;
    }

    this.resetDownloadState();

    const snapshotRanges = this.getSnapshotRanges();
    const modelRanges = this.getModelRanges(snapshotRanges);
    if (this.validateOptionInput()) {
      onDownloadStart();
      try {
        const frozenTable = await model.export();
        const tableSubscription = frozenTable.setViewport(0, 0);
        await tableSubscription.getViewportData();
        onDownload(
          fileName,
          frozenTable,
          tableSubscription,
          snapshotRanges,
          modelRanges,
          includeColumnHeaders,
          useUnformattedValues
        );
      } catch (error) {
        log.error('CSV download failed', error);

        this.setState({
          errorMessage: (
            <p>
              <FontAwesomeIcon icon={vsWarning} /> {`${error}`}
            </p>
          ),
        });
        onCancel();
      }
    }
  }

  handleDownloadRowOptionChanged(value: string): void {
    this.setState({ downloadRowOption: value });
  }

  handleCustomizedDownloadRowOptionChanged(value: ItemKey | null): void {
    if (value !== null) {
      this.setState({ customizedDownloadRowOption: String(value) });
    }
  }

  handleCustomizedDownloadRowsChanged(value: number): void {
    this.setState({ customizedDownloadRows: value });
  }

  handleIncludeColumnHeadersChanged(): void {
    this.setState(({ includeColumnHeaders }) => ({
      includeColumnHeaders: !includeColumnHeaders,
    }));
  }

  handleIncludeHiddenColumnsChanged(): void {
    this.setState(({ includeHiddenColumns }) => ({
      includeHiddenColumns: !includeHiddenColumns,
    }));
  }

  handleUseUnformattedValuesChanged(): void {
    this.setState(({ useUnformattedValues }) => ({
      useUnformattedValues: !useUnformattedValues,
    }));
  }

  validateOptionInput(): boolean {
    const { selectedRanges } = this.props;
    const { downloadRowOption, customizedDownloadRows } = this.state;

    if (
      downloadRowOption ===
        TableCsvExporter.DOWNLOAD_ROW_OPTIONS.SELECTED_ROWS &&
      selectedRanges.length === 0
    ) {
      this.setState({
        errorMessage: (
          <p>
            <FontAwesomeIcon icon={vsWarning} /> No rows selected. Please select
            some rows in the table.
          </p>
        ),
      });
      return false;
    }

    if (
      downloadRowOption ===
        TableCsvExporter.DOWNLOAD_ROW_OPTIONS.CUSTOMIZED_ROWS &&
      customizedDownloadRows <= 0
    ) {
      this.setState({
        errorMessage: (
          <p>
            <FontAwesomeIcon icon={vsWarning} /> Number of rows to output must
            be greater than 0
          </p>
        ),
      });
      return false;
    }
    return true;
  }

  render(): ReactElement {
    const {
      model,
      isDownloading,
      tableDownloadProgress,
      tableDownloadEstimatedTime,
      selectedRanges,
      tableDownloadStatus,
    } = this.props;
    const {
      fileName,
      downloadRowOption,
      customizedDownloadRowOption,
      customizedDownloadRows,
      includeColumnHeaders,
      includeHiddenColumns,
      useUnformattedValues,
      errorMessage,
      id,
    } = this.state;
    const { rowCount } = model;
    return (
      <div className="table-csv-exporter">
        <div id="download-rows-label" className="section-title">
          Download Rows
        </div>
        <div className="form-group">
          <RadioGroup
            aria-labelledby="download-rows-label"
            onChange={this.handleDownloadRowOptionChanged}
            value={downloadRowOption}
            isDisabled={isDownloading}
          >
            <Radio
              value={TableCsvExporter.DOWNLOAD_ROW_OPTIONS.ALL_ROWS}
              data-testid="radio-csv-exporter-download-all"
            >
              All Rows
              <span className="text-muted ml-2">
                {`(${rowCount
                  .toString()
                  .replace(/(\d)(?=(\d{3})+(?!\d))/g, '$1,')} rows)`}
              </span>
            </Radio>
            <Radio
              value={TableCsvExporter.DOWNLOAD_ROW_OPTIONS.SELECTED_ROWS}
              data-testid="radio-csv-exporter-only-selected"
            >
              Only Selected Rows
              <span className="text-muted ml-2">
                {selectedRanges.length > 0
                  ? `(${GridRange.rowCount(selectedRanges)
                      .toString()
                      .replace(/(\d)(?=(\d{3})+(?!\d))/g, '$1,')} rows)`
                  : null}
              </span>
            </Radio>
            <div className="d-flex">
              <Radio
                value={TableCsvExporter.DOWNLOAD_ROW_OPTIONS.CUSTOMIZED_ROWS}
                data-testid="radio-csv-exporter-customized-rows"
                margin="0"
                aria-label="Download a custom number of rows"
              />
              <div
                className="radio-input-row"
                role="presentation"
                onClick={() => {
                  this.setState({
                    downloadRowOption:
                      TableCsvExporter.DOWNLOAD_ROW_OPTIONS.CUSTOMIZED_ROWS,
                  });
                }}
              >
                <Picker
                  selectedKey={customizedDownloadRowOption}
                  data-testid="select-csv-exporter-customized-rows"
                  isDisabled={isDownloading}
                  onChange={this.handleCustomizedDownloadRowOptionChanged}
                  aria-label="First or last number of rows"
                  flex
                >
                  <Item key="FIRST">First</Item>
                  <Item key="LAST">Last</Item>
                </Picker>
                <NumberField
                  id={`customizedRows-${id}`}
                  data-testid="input-csv-exporter-customized-rows"
                  name={`customizedRows-${id}`}
                  minValue={1}
                  defaultValue={100}
                  value={customizedDownloadRows}
                  width="100%"
                  minWidth={0}
                  isDisabled={isDownloading}
                  onChange={this.handleCustomizedDownloadRowsChanged}
                  aria-label="Number of rows to download"
                  flex
                />
                <div>Rows</div>
              </div>
            </div>
          </RadioGroup>
        </div>
        <div className="form-group">
          <label htmlFor={`customizedRows-${id}`}>File Name</label>
          <input
            type="text"
            className="form-control"
            id={`filename-${id}`}
            data-testid="input-csv-exporter-file-name"
            name={`filename-${id}`}
            value={fileName}
            onChange={event => {
              this.setState({ fileName: event.target.value });
            }}
            disabled={isDownloading}
          />
        </div>
        <div className="checkbox-options">
          <Checkbox
            checked={includeColumnHeaders}
            onChange={this.handleIncludeColumnHeadersChanged}
          >
            Include column headers
          </Checkbox>
          <Checkbox
            checked={includeHiddenColumns}
            onChange={this.handleIncludeHiddenColumnsChanged}
          >
            Include hidden columns
          </Checkbox>
          <Checkbox
            checked={useUnformattedValues}
            onChange={this.handleUseUnformattedValuesChanged}
          >
            Use unformatted values
          </Checkbox>
        </div>
        <div className="section-footer flex-column">
          {errorMessage != null && (
            <div className="error-message">{errorMessage}</div>
          )}
          {tableDownloadStatus && (
            <div className="download-status">
              {(tableDownloadStatus ===
                TableCsvExporter.DOWNLOAD_STATUS.DOWNLOADING ||
                tableDownloadStatus ===
                  TableCsvExporter.DOWNLOAD_STATUS.INITIATING) && (
                <>
                  {tableDownloadStatus ===
                    TableCsvExporter.DOWNLOAD_STATUS.INITIATING && (
                    <div className="text-muted">Starting Download...</div>
                  )}
                  {tableDownloadStatus ===
                    TableCsvExporter.DOWNLOAD_STATUS.DOWNLOADING && (
                    <div className="text-muted d-flex justify-content-between">
                      <span>
                        {tableDownloadEstimatedTime ||
                        tableDownloadEstimatedTime === 0
                          ? `Estimated time: ${TimeUtils.formatElapsedTime(
                              tableDownloadEstimatedTime
                            )}`
                          : null}
                      </span>
                      <span>{`${tableDownloadProgress}%`}</span>
                    </div>
                  )}
                </>
              )}
              {tableDownloadStatus ===
                TableCsvExporter.DOWNLOAD_STATUS.FINISHED && (
                <div className="text-muted text-right">Download Completed</div>
              )}
              {tableDownloadStatus ===
                TableCsvExporter.DOWNLOAD_STATUS.CANCELED && (
                <div className="text-muted">Download Canceled</div>
              )}

              {(tableDownloadStatus ===
                TableCsvExporter.DOWNLOAD_STATUS.DOWNLOADING ||
                tableDownloadStatus ===
                  TableCsvExporter.DOWNLOAD_STATUS.INITIATING) && (
                <div className="progress">
                  <div
                    className="progress-bar progress-bar-striped progress-bar-animated"
                    style={{ width: `${tableDownloadProgress}%` }}
                  />
                </div>
              )}
              {tableDownloadStatus ===
                TableCsvExporter.DOWNLOAD_STATUS.FINISHED && (
                <div className="progress">
                  <div
                    className="progress-bar bg-success"
                    style={{ width: `${tableDownloadProgress}%` }}
                  />
                </div>
              )}
            </div>
          )}
          <Button
            kind="primary"
            data-testid="btn-csv-exporter-download"
            className={ClassNames('btn-downloading', {
              'btn-spinner btn-cancelable': isDownloading,
            })}
            onClick={this.handleDownloadClick}
          >
            {isDownloading && (
              <span>
                <LoadingSpinner className="mr-2 loading-spinner-vertical-align" />
                <span className="btn-normal-content">Downloading</span>
                <span className="btn-hover-content">Cancel</span>
              </span>
            )}
            {!isDownloading && 'Download'}
          </Button>
        </div>
      </div>
    );
  }
}

export default TableCsvExporter;
