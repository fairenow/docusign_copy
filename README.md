# DocSign - Document Signer

A free, privacy-focused document signing application built with React. Upload PDFs or DOCX files and add signatures, text fields, dates, initials, and checkboxes.

![DocSign Screenshot](https://via.placeholder.com/800x450?text=DocSign+Preview)

## Features

- 📄 **PDF & DOCX Support** - Upload and view both file types
- ✍️ **Signature Drawing** - Draw signatures with mouse or touch
- ⌨️ **Typed Signatures** - Type your name in a cursive style
- 📝 **Text Fields** - Add custom text with configurable size and color
- 📅 **Date Fields** - Auto-filled with current date
- 🔤 **Initials** - Quick initial placement
- ☑️ **Checkboxes** - Toggleable checkboxes
- 📑 **Multi-page PDF** - Navigate through PDF pages
- 🔍 **Zoom Controls** - Zoom in/out for precision
- ⬇️ **PDF Export** - Download signed document as PDF

## Getting Started

### Prerequisites

- Node.js 18+ 
- npm or yarn

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/docsign-react.git
cd docsign-react

# Install dependencies
npm install

# Start development server
npm run dev
```

The app will be available at `http://localhost:5173`

### Building for Production

```bash
npm run build
```

## Deployment to Vercel

### Option 1: One-Click Deploy

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/yourusername/docsign-react)

### Option 2: CLI Deploy

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel
```

### Option 3: Git Integration

1. Push your code to GitHub/GitLab/Bitbucket
2. Import the project in [Vercel Dashboard](https://vercel.com/new)
3. Vercel will auto-detect Vite and deploy

## Tech Stack

- **React 18** - UI framework
- **Vite** - Build tool
- **Tailwind CSS** - Styling
- **PDF.js** - PDF rendering
- **Mammoth.js** - DOCX to HTML conversion
- **jsPDF** - PDF generation
- **Lucide React** - Icons

## Project Structure

```
docsign-react/
├── public/
│   └── favicon.svg
├── src/
│   ├── components/
│   │   ├── DocumentViewer.jsx
│   │   ├── LoadingOverlay.jsx
│   │   ├── OverlayElement.jsx
│   │   ├── Sidebar.jsx
│   │   ├── SignaturePanel.jsx
│   │   ├── TextOptions.jsx
│   │   └── Toolbar.jsx
│   ├── hooks/
│   │   └── useDocument.js
│   ├── utils/
│   │   └── pdfGenerator.js
│   ├── App.jsx
│   ├── index.css
│   └── main.jsx
├── index.html
├── package.json
├── tailwind.config.js
├── vite.config.js
└── vercel.json
```

## Privacy

All document processing happens locally in your browser. No files are uploaded to any server.

## License

MIT License - feel free to use this for personal or commercial projects.

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.
