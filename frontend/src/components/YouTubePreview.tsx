import React from 'react';

interface YouTubePreviewProps {
  htmlContent: string;
}

const YouTubePreview: React.FC<YouTubePreviewProps> = ({ htmlContent }) => {
  return (
    <>
      <style>{`
        .youtube-preview-container iframe {
          width: 100% !important;
          height: 100% !important;
        }
      `}</style>
      <div
        className="youtube-preview-container mt-2 rounded-xl overflow-hidden aspect-video w-[80vw] max-w-3xl"
        dangerouslySetInnerHTML={{ __html: htmlContent }}
      />
    </>
  );
};

export default React.memo(YouTubePreview);
