import React from 'react';

interface SpotifyPreviewProps {
  htmlContent: string;
}

const SpotifyPreview: React.FC<SpotifyPreviewProps> = ({ htmlContent }) => {
  return (
    <>
      <style>{`
        .spotify-preview-container iframe {
          width: 100% !important;
          min-height: 352px;
        }
      `}</style>
      <div
        className="spotify-preview-container mt-2 rounded-xl overflow-hidden"
        dangerouslySetInnerHTML={{ __html: htmlContent }}
      />
    </>
  );
};

export default React.memo(SpotifyPreview);
