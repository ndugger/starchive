import * as EXIF from 'piexif-ts';
import * as FileSystem from 'fs';
import * as HTTPS from 'https';
import * as Moment from 'moment';
import * as XML from 'xml2js';

/**
 * Asynchronously download resource from HTTPS address
 */
async function download(address: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const request = HTTPS.get(address, response => {
            let resource = Buffer.from([]);

            response.on('data', chunk => {
                resource = Buffer.concat([ resource, chunk ]);
            });

            response.on('end', () => {
                if (response.statusCode >= 400) {
                    reject(new Error(resource.toString()));
                }
                else {
                    resolve(resource);
                }
            });
        });

        request.on('error', reject);
    });
}

/**
 * Retrieve all photos by year from given index
 */
async function starchive(index: string): Promise<void> {
    try {
        const binary = await download(`${ index }/`);
        const directory = binary.toString().matchAll(/<a href="\d{4}\/">(\d{4})\/<\/a>/g);

        /**
         * Query each folder representing a year
         */
        for (const [ , year ] of directory) try {
            /**
             * Create corresponding directory for each year
             */
            if (!FileSystem.existsSync(`img/${ year }/`)) try {
                FileSystem.mkdirSync(`img/${ year }/`, { recursive: true });
            }
            catch (error) {
                console.error(error);
                continue;
            }

            const binary = await download(`${ index }/${ year }/text/`);
            const directory = Array.from(binary.toString().matchAll(/<a href=".+?\.txt">(.+?)\.txt<\/a>/g));

            /**
             * Query each entry within the year's metadata text documents
             */
            if (directory.length > 0) for (const [ , entry ] of directory) try {
                const binary = await download(`${ index }/${ year }/text/${ entry }.txt`);
                const text = binary.toString().trim().replace(/^\{\}.+?\n/, '');
                const metadata = <any>{
                    sources: {
                        high: `${ index }/${ year }/high/${ entry }.jpg`,
                        medium: `${ index }/${ year }/medium/${ entry }.jpg`,
                        low: `${ index }/${ year }/low/${ entry }.gif`
                    },
                    number: entry,
                    title: entry
                };

                /**
                 * Parse metadata text document into consummable key-value pairs
                 */
                for (const line of text.split('\n')) if (line.trim()) {
                    const [ , key, value ] = line.match(/(?:\{(.+?)\})?(.+)/);

                    /**
                     * Ignore redundant image attribution
                     */
                    if (key && (key === 'type' || [ 'high', 'medium', 'low', 'slide', 'tiny', 'thumb' ].some(size => key.startsWith(size)))) {
                        continue;
                    }

                    if (key) {
                        metadata[ key.toLowerCase() ] = value.trim();
                    }
                    else if (value.trim() && value !== '{end}') {
                        metadata[ Object.keys(metadata)[ Object.keys(metadata).length - 1 ] ] += ` ${ value.trim() }`;
                    }
                }

                /**
                 * Separate EXIF fields from comment JSON dump due to field size limits
                 */
                const { author, date, description, keywords, ...comment } = metadata;
                const exif = EXIF.dump({
                    '0th': {
                        [ EXIF.TagValues.ImageIFD.Artist ]: author ?? 'UNKNOWN',
                        [ EXIF.TagValues.ImageIFD.ImageDescription ]: description ?? 'UNKNOWN',
                        [ EXIF.TagValues.ImageIFD.XPKeywords ]: [ ...Buffer.from(keywords ?? 'UNKNOWN', 'ucs2') ],
                        [ EXIF.TagValues.ImageIFD.XPComment ]: [ ...Buffer.from(JSON.stringify(comment), 'ucs2') ]
                    },
                    'Exif': {
                        [ EXIF.TagValues.ExifIFD.DateTimeOriginal ]: Moment(date, 'DD-MMM-YYYY').format('YYYY:MM:DD')
                    }
                });

                /**
                 * Download photo binary
                 */
                try {
                    const photo = await download(metadata.sources.high);

                    /**
                     * Save image to local file system
                     */
                    try {
                        FileSystem.writeFileSync(`img/${ year }/${ entry }.jpg`, Buffer.from(EXIF.insert(exif, photo.toString('binary')), 'binary'));
                    }
                    catch (error) {
                        console.error(error, year, entry, metadata);
                    }
                } 
                catch {
                    /**
                     * Fallback to medium res if high res is missing or fails to download
                     */
                    try {
                        const photo = await download(metadata.sources.medium);
    
                        /**
                         * Save image to local file system
                         */
                        try {
                            FileSystem.writeFileSync(`img/${ year }/${ entry }.jpg`, Buffer.from(EXIF.insert(exif, photo.toString('binary')), 'binary'));
                        }
                        catch (error) {
                            console.error(error, year, entry, metadata);
                        }
                    } 
                    catch (error) {
                        console.error(error, year, entry, metadata);
                    }
                }
            }
            catch (error) {
                console.error(error, year, entry);
            }
            else try {
                const binary = await download(`${ index }/${ year }/xml/`);
                const directory = Array.from(binary.toString().matchAll(/<a href=".+?\.xml">(.+?)\.xml<\/a>/g));

                /**
                 * Fallback to xml if text documents are missing or fail to download
                 */
                for (const [ , entry ] of directory) {
                    const binary = await download(`${ index }/${ year }/xml/${ entry }.xml`);
                    const xml = await XML.parseStringPromise(binary.toString());
                    const metadata = <any>{
                        author: xml.asset.text[ 0 ]?.org[ 0 ]?.name?.join(', ').trim(),
                        date: xml.asset.text[ 0 ]?.date?.join(', ').trim(),
                        description: xml.asset.text[ 0 ]?.description?.join(', ').trim(),
                        number: entry,
                        title: entry,
                        sources: {
                            high: `${ index }/${ year }/high/${ entry }.jpg`,
                            medium: `${ index }/${ year }/medium/${ entry }.jpg`,
                            low: `${ index }/${ year }/low/${ entry }.gif`
                        }
                    };

                    /**
                     * Separate EXIF fields from comment JSON dump due to field size limits
                     */
                    const { author, date, description, keywords, ...comment } = metadata;
                    const exif = EXIF.dump({
                        '0th': {
                            [ EXIF.TagValues.ImageIFD.Artist ]: author ?? 'UNKNOWN',
                            [ EXIF.TagValues.ImageIFD.ImageDescription ]: description ?? 'UNKNOWN',
                            [ EXIF.TagValues.ImageIFD.XPKeywords ]: [ ...Buffer.from(keywords ?? 'UNKNOWN', 'ucs2') ],
                            [ EXIF.TagValues.ImageIFD.XPComment ]: [ ...Buffer.from(JSON.stringify(comment), 'ucs2') ]
                        },
                        'Exif': {
                            [ EXIF.TagValues.ExifIFD.DateTimeOriginal ]: Moment(date, 'YYYY-MM-DD').format('YYYY:MM:DD')
                        }
                    });

                    /**
                     * Download photo binary
                     */
                    try {
                        const photo = await download(metadata.sources.high);

                        /**
                         * Save image to local file system
                         */
                        try {
                            FileSystem.writeFileSync(`img/${ year }/${ entry }.jpg`, Buffer.from(EXIF.insert(exif, photo.toString('binary')), 'binary'));
                        }
                        catch (error) {
                            console.error(error, year, entry, metadata);
                        }
                    } 
                    catch {
                        /**
                         * Fallback to medium res if high res is missing or fails to download
                         */
                        try {
                            const photo = await download(metadata.sources.medium);
        
                            /**
                             * Save image to local file system
                             */
                            try {
                                FileSystem.writeFileSync(`img/${ year }/${ entry }.jpg`, Buffer.from(EXIF.insert(exif, photo.toString('binary')), 'binary'));
                            }
                            catch (error) {
                                console.error(error, year, entry, metadata);
                            }
                        } 
                        catch (error) {
                            console.error(error, year, entry, metadata);
                        }
                    }
                }
            }
            catch (error) {
                console.error(error, year);
            }
        }
        catch (error) {
            console.error(error, year);
        }
    }
    catch (error) {
        console.error(error);
    }
}

starchive('https://science.ksc.nasa.gov/gallery/photos');
