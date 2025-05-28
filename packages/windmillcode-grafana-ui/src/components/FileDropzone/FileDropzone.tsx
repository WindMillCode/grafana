import { useEffect } from 'react';
import { css, cx } from '@emotion/css';
import { getAppEvents } from '@grafana/runtime';
import { isString, uniqueId } from 'lodash';
import { ReactNode, useCallback, useState } from 'react';
import { Accept, DropEvent, DropzoneOptions, FileError, FileRejection, useDropzone } from 'react-dropzone';

import { AppEvents, GrafanaTheme2 } from '@grafana/data';

import { Icon } from '@grafana/ui';

import { FileListItem } from './FileListItem';
import { useTheme2 } from '@grafana/ui';

type BackwardsCompatibleDropzoneOptions = Omit<DropzoneOptions, 'accept'> & {
  // For backward compatibility we are still allowing the old `string | string[]` format for adding accepted file types (format changed in v13.0.0)
  accept?: string | string[] | Accept;
  acceptString?: string;
};

export interface FileDropzoneProps {
  /**
   * Use the children property to have custom dropzone view.
   */
  children?: ReactNode;
  /**
   * Use this property to override the default behaviour for the react-dropzone options.
   * @default {
   *  maxSize: Infinity,
   *  minSize: 0,
   *  multiple: true,
   *  useFsAccessApi: false,
   *  maxFiles: 0,
   * }
   */
  options?: BackwardsCompatibleDropzoneOptions;
  /**
   * Use this to change the FileReader's read.
   */
  readAs?: 'readAsArrayBuffer' | 'readAsText' | 'readAsBinaryString' | 'readAsDataURL';
  /**
   * Use the onLoad function to get the result from FileReader.
   */
  onLoad?: (result: string | ArrayBuffer | null) => void;
  /**
   * The fileListRenderer property can be used to overwrite the list of files. To not to show
   * any list return null in the function.
   */
  fileListRenderer?: (file: DropzoneFile, removeFile: (file: DropzoneFile) => void) => ReactNode;
  onFileRemove?: (file: DropzoneFile) => void;
}

export interface DropzoneFile {
  file: File;
  id: string;
  error: DOMException | null;
  progress?: number;
  abortUpload?: () => void;
  retryUpload?: () => void;
}

type FileSizeUnit = 'B' | 'KB' | 'MB' | 'GB' | 'TB' | 'PB';

function convertFileSize(
  x: number = 0,
  inputUnit: FileSizeUnit = 'B',
  outputUnit: FileSizeUnit | 'AUTO' = 'AUTO',
  decimals: number = 2
): number | string {
  const units: FileSizeUnit[] = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  inputUnit = inputUnit.toUpperCase() as FileSizeUnit;
  outputUnit = outputUnit.toUpperCase() as FileSizeUnit | 'AUTO';

  // Validate units
  if (!units.includes(inputUnit)) {
    throw new Error(`Invalid input unit. Must be one of: ${units.join(', ')}`);
  }
  if (outputUnit !== 'AUTO' && !units.includes(outputUnit)) {
    throw new Error(`Invalid output unit. Must be one of: ${units.join(', ')} or "AUTO"`);
  }

  // Convert to bytes first
  const unitIndex = units.indexOf(inputUnit);
  const bytes = x * Math.pow(1000, unitIndex);

  // If outputUnit is specified, convert directly
  if (outputUnit !== 'AUTO') {
    const outputIndex = units.indexOf(outputUnit);
    const result = bytes / Math.pow(1000, outputIndex);
    return decimals === undefined ? result : parseFloat(result.toFixed(decimals));
  }

  // Otherwise, find the best-fit unit
  let bestUnitIndex = 0;
  let bestValue = bytes;
  for (let i = 0; i < units.length; i++) {
    const currentValue = bytes / Math.pow(1000, i);
    if (currentValue >= 1) {
      bestValue = currentValue;
      bestUnitIndex = i;
    } else {
      break;
    }
  }

  const roundedValue = parseFloat(bestValue.toFixed(decimals));
  return `${roundedValue} ${units[bestUnitIndex]}`;
}

export function FileDropzone({ options, children, readAs, onLoad, fileListRenderer, onFileRemove }: FileDropzoneProps) {
  const [files, setFiles] = useState<DropzoneFile[]>([]);
  const [fileErrors, setErrorMessages] = useState<FileError[]>([]);
  const appEvents = getAppEvents();

  const formattedSize = convertFileSize(options?.maxSize);

  const setFileProperty = useCallback(
    (customFile: DropzoneFile, action: (customFileToModify: DropzoneFile) => void) => {
      setFiles((oldFiles) => {
        return oldFiles.map((oldFile) => {
          if (oldFile.id === customFile.id) {
            action(oldFile);
            return oldFile;
          }
          return oldFile;
        });
      });
    },
    []
  );

  const removeFile = (file: DropzoneFile) => {
    const newFiles = files.filter((f) => file.id !== f.id);
    setFiles(newFiles);
    onFileRemove?.(file);
  };

  const onDrop = useCallback(
    (acceptedFiles: File[], rejectedFiles: FileRejection[], event: DropEvent) => {
      let customFiles = acceptedFiles.map(mapToCustomFile);
      if (options?.multiple === false) {
        setFiles(customFiles);
      } else {
        setFiles((oldFiles) => [...oldFiles, ...customFiles]);
      }

      setErrors(rejectedFiles);

      if (options?.onDrop) {
        // @ts-ignore
        options.onDrop(acceptedFiles, rejectedFiles, event, removeFile);
      } else {
        for (const customFile of customFiles) {
          const reader = new FileReader();

          const read = () => {
            if (readAs) {
              reader[readAs](customFile.file);
            } else {
              reader.readAsText(customFile.file);
            }
          };

          // Set abort FileReader
          setFileProperty(customFile, (fileToModify) => {
            fileToModify.abortUpload = () => {
              reader.abort();
            };
            fileToModify.retryUpload = () => {
              setFileProperty(customFile, (fileToModify) => {
                fileToModify.error = null;
                fileToModify.progress = undefined;
              });
              read();
            };
          });

          reader.onabort = () => {
            setFileProperty(customFile, (fileToModify) => {
              fileToModify.error = new DOMException('Aborted');
            });
          };

          reader.onprogress = (event) => {
            setFileProperty(customFile, (fileToModify) => {
              fileToModify.progress = event.loaded;
            });
          };

          reader.onload = () => {
            onLoad?.(reader.result);
          };

          reader.onerror = () => {
            setFileProperty(customFile, (fileToModify) => {
              fileToModify.error = reader.error;
            });
          };

          read();
        }
      }
    },
    [onLoad, options, readAs, setFileProperty]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    ...options,
    useFsAccessApi: false,
    onDrop,
    accept: transformAcceptToNewFormat(options?.accept),
  });
  const theme = useTheme2();
  const styles = getStyles(theme, isDragActive);
  const fileList = files.map((file) => {
    if (fileListRenderer) {
      return fileListRenderer(file, removeFile);
    }
    return <FileListItem key={file.id} file={file} removeFile={removeFile} />;
  });

  const setErrors = (rejectedFiles: FileRejection[]) => {
    let errors: FileError[] = [];
    rejectedFiles.map((rejectedFile) => {
      rejectedFile.errors.map((newError) => {
        if (
          errors.findIndex((presentError) => {
            return presentError.code === newError.code && presentError.message === newError.message;
          }) === -1
        ) {
          if (newError.code === 'file-too-large') {
            newError.message = 'File is larger than ' + formattedSize;
          }
          errors.push(newError);
        }
      });
    });

    setErrorMessages(errors);
  };

  // const renderErrorMessages = (errors: FileError[]) => {
  //   const size = formattedValueToString(formattedSize);
  //   return (
  //     <div className={styles.errorAlert}>
  //       <Alert
  //         title={"Upload failed"}
  //         severity="error"
  //         onRemove={clearAlert}
  //       >
  //         {errors.map((error) => {
  //           switch (error.code) {
  //             case ErrorCode.FileTooLarge:
  //               return (
  //                 <div key={error.message + error.code}>
  //                   <p >File is larger than {size}</p>
  //                 </div>
  //               );
  //             default:
  //               return <div key={error.message + error.code}>{error.message}</div>;
  //           }
  //         })}
  //       </Alert>
  //     </div>
  //   );
  // };

  // const clearAlert = () => {
  //   setErrorMessages([]);
  // };

  const fileTypeIsValidated = options?.accept || options?.acceptString;

  useEffect(() => {
    fileErrors.forEach((myError) => {
      appEvents.publish({
        type: AppEvents.alertError.name,
        payload: [myError.message],
      });
    });
  }, [fileErrors]);

  return (
    <div className={styles.container}>
      <div data-testid="dropzone" {...getRootProps({ className: styles.dropzone })}>
        <input {...getInputProps()} />
        {children ?? <FileDropzoneDefaultChildren primaryText={getPrimaryText(files, options)} />}
        {(options?.maxSize ?? 0 > 0) && (
          <small className={cx(styles.small, styles.acceptContainer)}>{`Max file size: ${formattedSize}`}</small>
        )}
        <small className={cx(styles.small, styles.acceptContainer)}>
          {fileTypeIsValidated && getAcceptedFileTypeText(options?.accept, options.acceptString)}
        </small>
      </div>
      {fileList}
    </div>
  );
}

export function getMimeTypeByExtension(ext: string) {
  if (['txt', 'json', 'csv', 'xls', 'yml'].some((e) => ext.match(e))) {
    return 'text/plain';
  }

  return 'application/octet-stream';
}

export function transformAcceptToNewFormat(accept?: string | string[] | Accept): Accept | undefined {
  if (isString(accept)) {
    return {
      [getMimeTypeByExtension(accept)]: [accept],
    };
  }

  if (Array.isArray(accept)) {
    return accept.reduce((prev: Record<string, string[]>, current) => {
      const mime = getMimeTypeByExtension(current);

      prev[mime] = prev[mime] ? [...prev[mime], current] : [current];

      return prev;
    }, {});
  }

  return accept;
}

export function FileDropzoneDefaultChildren({ primaryText = 'Drop file here or click to upload', secondaryText = '' }) {
  const theme = useTheme2();
  const styles = getStyles(theme);

  return (
    <div className={cx(styles.defaultDropZone)} data-testid="file-drop-zone-default-children">
      <Icon className={cx(styles.icon)} name="upload" size="xl" />
      <h6 className={cx(styles.primaryText)}>{primaryText}</h6>
      <small className={styles.small}>{secondaryText}</small>
    </div>
  );
}

function getPrimaryText(files: DropzoneFile[], options?: BackwardsCompatibleDropzoneOptions) {
  if (options?.multiple === undefined || options?.multiple) {
    return 'Upload file';
  }
  return files.length ? 'Replace file' : 'Upload file';
}

function getAcceptedFileTypeText(accept: string | string[] | Accept | any, acceptString?: string) {
  if (typeof acceptString === 'string') {
    return acceptString;
  }
  if (isString(accept)) {
    return `Accepted file type: ${accept}`;
  }

  if (Array.isArray(accept)) {
    return `Accepted file types: ${accept.join(', ')}`;
  }

  if ([null, undefined, ''].includes(accept)) {
    return '';
  }
  // react-dropzone has updated the type of the "accept" parameter since v13.0.0:
  // https://github.com/react-dropzone/react-dropzone/blob/master/src/index.js#L95
  return `Accepted file types: ${Object.values(accept).flat().join(', ')}`;
}

function mapToCustomFile(file: File): DropzoneFile {
  return {
    id: uniqueId('file'),
    file,
    error: null,
  };
}

function getStyles(theme: GrafanaTheme2, isDragActive?: boolean) {
  return {
    container: css({
      display: 'flex',
      flexDirection: 'column',
      width: '100%',
      padding: theme.spacing(2),
      borderRadius: theme.shape.radius.default,
      border: `1px dashed ${theme.colors.border.strong}`,
      backgroundColor: isDragActive ? theme.colors.background.secondary : theme.colors.background.primary,
      cursor: 'pointer',
      alignItems: 'center',
      justifyContent: 'center',
    }),
    dropzone: css({
      height: '100%',
      width: '100%',
      display: 'flex',
      flexDirection: 'column',
    }),
    defaultDropZone: css({
      textAlign: 'center',
    }),
    icon: css({
      marginBottom: theme.spacing(1),
    }),
    primaryText: css({
      marginBottom: theme.spacing(1),
    }),
    acceptContainer: css({
      textAlign: 'center',
      margin: 0,
    }),
    acceptSeparator: css({
      margin: `0 ${theme.spacing(1)}`,
    }),
    small: css({
      color: theme.colors.text.secondary,
    }),
    errorAlert: css({
      paddingTop: '10px',
    }),
  };
}
