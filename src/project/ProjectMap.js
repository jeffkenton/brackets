/*
 * Copyright (c) 2013 Adobe Systems Incorporated. All rights reserved.
 *  
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the "Software"), 
 * to deal in the Software without restriction, including without limitation 
 * the rights to use, copy, modify, merge, publish, distribute, sublicense, 
 * and/or sell copies of the Software, and to permit persons to whom the 
 * Software is furnished to do so, subject to the following conditions:
 *  
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *  
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, 
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER 
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING 
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER 
 * DEALINGS IN THE SOFTWARE.
 * 
 */

/*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4, maxerr: 50 */
/*global define, $, brackets, FileError, window */

/**
 * ProjectMap builds a graph of the project, starting with all the HTML files in the
 * directory tree, and looking (recursively) for CSS and script files referenced.
 */
define(function (require, exports, module) {
    "use strict";

    require("utils/Global");
    
    // Load dependent modules
    var AppInit             = require("utils/AppInit"),
        NativeFileSystem    = require("file/NativeFileSystem").NativeFileSystem,
        StringUtils         = require("utils/StringUtils"),
        Strings             = require("strings"),
        PerfUtils           = require("utils/PerfUtils"),
        CollectionUtils     = require("utils/CollectionUtils"),
        FileUtils           = require("file/FileUtils"),
        NativeFileError     = require("file/NativeFileError"),
        FileIndexManager    = require("project/FileIndexManager"),
        ProjectManager      = require("project/ProjectManager"),
        Urls                = require("i18n!nls/urls"),
        Async               = require("utils/Async");

    /**
     * @private
     */
    var _htmlFiles = {};
    var _jsFiles = {};
    var _cssFiles = {};

    /**
     * @private
     * RegEx to validate if a filename is not allowed even if the system allows it.
     * This is done to prevent cross-platform issues.  
     * Invalid Windows filenames:
     * See http://msdn.microsoft.com/en-us/library/windows/desktop/aa365247(v=vs.85).aspx
     */
    var _illegalFilenamesRegEx = /^(\.+|com[1-9]|lpt[1-9]|nul|con|prn|aux)$/i;

    /**
     * @private
     *
     * Check a filename for illegal characters or special names.
     * Logic matches ProjectManager::_checkForValidFilename().
     */
    function _checkForValidFilename(filename) {
        if ((filename.search(/[\/?*:;\{\}<>\\|]+/) !== -1) || filename.match(_illegalFilenamesRegEx)) {
            return false;
        }
        return true;
    }

    /**
     * @private
     *
     * Process list of JavaScript files.
     */
    function _processJSFileList() {
        while (! _jsFiles.processed) {
            _jsFiles.processed = true;

            for (var file in _jsFiles) {
                if (! _jsFiles[file].processed) {
                    _jsFiles[file].processed = true;

                    // Scan file for CSS and JavaScript.
                    NativeFileSystem.resolveNativeFileSystemPath(file, function (fileEntry) {
                        FileUtils.readAsText(fileEntry).done(function (text) {

                            // Find require in JS file text.
                            var reqs = text.match(/.*require.*/g);
                            if (reqs) {
                                // console.log("Directory: " + directory);
                                for (var i = 0; i < reqs.length; ++i) {
                                    var m = reqs[i].match(/["']([^"']*)/);
                                    if (m) {
                                        var jsFile = directory + m[1];
                                        if ( !_jsFiles[jsFile] ) {
                                            _jsFiles[jsFile] = {parents: {}, children: {}};
                                        }
                                        _htmlFiles[file].jsChildren[jsFile] = _jsFiles[jsFile];
                                        _jsFiles[jsFile].parents[file] = _htmlFiles[file];
                                        _jsFiles.processed = false;
                                        console.log("   require: " + jsFile)
                                    }
                                }
                            }

                        }).fail(function (error) {
                        });
                    }, function (error) {
                    });
                }
            }
        }
    }

    /**
     * @private
     *
     * Process list of CSS files.
     */
    function _processCSSFileList() {
        while (! _cssFiles.processed) {
            _cssFiles.processed = true;

            for (var file in _cssFiles) {
                if (! _cssFiles[file].processed) {
                    _cssFiles[file].processed = true;

                    // Scan file for CSS and JavaScript.
                    NativeFileSystem.resolveNativeFileSystemPath(file, function (fileEntry) {
                        FileUtils.readAsText(fileEntry).done(function (text) {

                            // Find @import in CSS file text.
                            var imports = text.match(/.*@import.*/g);
                            if (imports) {
                                // console.log("Directory: " + directory);
                                for (var i = 0; i < imports.length; ++i) {
                                    var m = imports[i].match(/["']([^"']*)/);
                                    if (m) {
                                        var cssFile = directory + m[1];
                                        if ( !_cssFiles[cssFile] ) {
                                            _cssFiles[cssFile] = {parents: {}, children: {}};
                                        }
                                        _htmlFiles[file].cssChildren[cssFile] = _cssFiles[cssFile];
                                        _cssFiles[cssFile].parents[file] = _htmlFiles[file];
                                        _cssFiles.processed = false;
                                        console.log("   @import: " + cssFile)
                                    }
                                }
                            }

                        }).fail(function (error) {
                        });
                    }, function (error) {
                    });
                }
            }
        }
    }

    /**
     * @private
     *
     * Process list of HTML files.
     *
     * TODO: improve regex's to match the real world.
     */
    function _processHTMLFileList() {

        // Helper function -- read one HTML file and scan for CSS and Javascript.
        function _readHTMLFile(htmlFile) {

            var file = htmlFile;
            var directory = file.substr(0, file.lastIndexOf("/") + 1);

            // Scan file for CSS and JavaScript.
            NativeFileSystem.resolveNativeFileSystemPath(file, function (fileEntry) {
                FileUtils.readAsText(fileEntry).done(function (text) {

                    // Find <link>'s in HTML file text.
                    var links = text.match(/<link .*rel="stylesheet".*>/g);
                    if (links) {
                        // console.log("Directory: " + directory);
                        for (var i = 0; i < links.length; ++i) {
                            var m = links[i].match(/href="([^"]*)/);
                            if (m) {
                                var cssFile = directory + m[1];
                                if ( !_cssFiles[cssFile] ) {
                                    _cssFiles[cssFile] = {parents: {}, children: {}};
                                }
                                _htmlFiles[file].cssChildren[cssFile] = _cssFiles[cssFile];
                                _cssFiles[cssFile].parents[file] = _htmlFiles[file];
                                console.log("   <link>: " + cssFile)
                            }
                        }
                    }

                    // Find @import in HTML file text.
                    var imports = text.match(/.*@import.*/g);
                    if (imports) {
                        // console.log("Directory: " + directory);
                        for (var i = 0; i < imports.length; ++i) {
                            var m = imports[i].match(/["']([^"']*)/);
                            if (m) {
                                var cssFile = directory + m[1];
                                if ( !_cssFiles[cssFile] ) {
                                    _cssFiles[cssFile] = {parents: {}, children: {}};
                                }
                                _htmlFiles[file].cssChildren[cssFile] = _cssFiles[cssFile];
                                _cssFiles[cssFile].parents[file] = _htmlFiles[file];
                                console.log("   @import: " + cssFile)
                            }
                        }
                    }

                    // Find javascript <script> tags.
                    var scripts = text.match(/<script .*src=["'].*>/g);
                    if (scripts) {
                        // console.log("Directory: " + directory);
                        for (var i = 0; i < scripts.length; ++i) {
                            var m = scripts[i].match(/src=["']([^"']*)/);
                            if (m) {
                                if (m[1].search(/\.js/) != -1) {
                                    var jsFile = directory + m[1];
                                    if ( !_jsFiles[jsFile] ) {
                                        _jsFiles[jsFile] = {parents: {}, children: {}};
                                    }
                                    _htmlFiles[file].jsChildren[jsFile] = _jsFiles[jsFile];
                                    _jsFiles[jsFile].parents[file] = _htmlFiles[file];
                                    console.log("   <script>: " + jsFile)
                                }
                            }
                        }
                    }

                }).fail(function (error) {
                });
            }, function (error) {
            });
        }

        // Read all the HTML files.
        for (var file in _htmlFiles) {
            if (_htmlFiles[file].processed) {
                continue;
            }

            _htmlFiles[file].jsChildren = {};
            _htmlFiles[file].cssChildren = {};

            _readHTMLFile(file);

            _htmlFiles[file].processed = true;
        }
    }

    /**
     * @private
     *
     * Get list of HTML files and build the map.
     */
    function _getHTMLFiles() {
        FileIndexManager.getFileInfoList("html")
            .done(function (fileList) {
                var i,
                    file;

                // console.log("HTML fileList: " + fileList.length);
                for (i = 0; i < fileList.length; ++i) {
                    file = fileList[i];
                    if (!_checkForValidFilename(file.name)) {
                        continue;
                    }
                    if (_htmlFiles.hasOwnProperty(file)) {
                        continue;
                    }
                    // console.log("...: " + file.fullPath);
                    _htmlFiles[file.fullPath] = { processed: false };
                }

                _processHTMLFileList();
                _processCSSFileList();
                _processJSFileList();
            })
            .fail(function () {
            });
    }

    /**
     * @private
     *
     * Build map of project files.
     */
    function _buildProjectMap() {

        // Reset the world:
        _htmlFiles = {};
        _jsFiles = {};
        _cssFiles = {};

        // Build the map.
        _getHTMLFiles();
    }

    // Register.
    $(ProjectManager).on("projectOpen", function () {
        _buildProjectMap();
    });

    // TODO: Define public API
});
