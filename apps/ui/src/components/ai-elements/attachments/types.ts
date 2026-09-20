/** AI SDK FileUIPart / SourceDocumentUIPart 的最小兼容子集：
 *  只声明本组件用到的字段，避免为类型引入 ai 运行时依赖 */
export interface FileUIPart {
  type: 'file'
  mediaType?: string
  filename?: string
  url: string
}

export interface SourceDocumentUIPart {
  type: 'source-document'
  mediaType?: string
  title?: string
  filename?: string
  url?: string
}

export type AttachmentData
  = | (FileUIPart & { id: string; path?: string })
    | (SourceDocumentUIPart & { id: string; path?: string })

export type AttachmentMediaCategory
  = | 'image'
    | 'video'
    | 'audio'
    | 'document'
    | 'source'
    | 'unknown'

export type AttachmentVariant = 'grid' | 'inline' | 'list'
