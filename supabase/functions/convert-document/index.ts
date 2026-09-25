// Converts Word, OpenDocument and RTF files to PDF with LibreOffice (see _shared/converter.ts).
// JWT verification is done in code (requireUser), matching signing-api.
import { serve } from '../_shared/http.ts'
import { convertDocument } from '../_shared/handlers/convert-document.ts'

serve(convertDocument)
