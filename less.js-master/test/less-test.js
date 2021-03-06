/*jshint latedef: nofunc */

module.exports = function() {
    var path = require('path'),
        fs = require('fs'),
        copyBom = require('./copy-bom')(),
        doBomTest = false;

    var less = require('../lib/less-node');
    var stylize = require('../lib/less-node/lessc-helper').stylize;

    var globals = Object.keys(global);

    var oneTestOnly = process.argv[2],
        isFinished = false;

    var isVerbose = process.env.npm_config_loglevel === 'verbose';

    var normalFolder = 'test/less';
    var bomFolder = 'test/less-bom';

    less.logger.addListener({
        info: function(msg) {
            if (isVerbose) {
                process.stdout.write(msg + "\n");
            }
        },
        warn: function(msg) {
            process.stdout.write(msg + "\n");
        },
        error: function(msg) {
            process.stdout.write(msg + "\n");
        }
    });

    var queueList = [],
        queueRunning = false;
    function queue(func) {
        if (queueRunning) {
            //console.log("adding to queue");
            queueList.push(func);
        } else {
            //console.log("first in queue - starting");
            queueRunning = true;
            func();
        }
    }
    function release() {
        if (queueList.length) {
            //console.log("running next in queue");
            var func = queueList.shift();
            setTimeout(func, 0);
        } else {
            //console.log("stopping queue");
            queueRunning = false;
        }
    }

    var totalTests = 0,
        failedTests = 0,
        passedTests = 0;

    less.functions.functionRegistry.addMultiple({
        add: function (a, b) {
            return new(less.tree.Dimension)(a.value + b.value);
        },
        increment: function (a) {
            return new(less.tree.Dimension)(a.value + 1);
        },
        _color: function (str) {
            if (str.value === "evil red") { return new(less.tree.Color)("600"); }
        }
    });

    function testSourcemap(name, err, compiledLess, doReplacements, sourcemap, baseFolder) {
        fs.readFile(path.join('test/', name) + '.json', 'utf8', function (e, expectedSourcemap) {
            process.stdout.write("- " + path.join(baseFolder, name) + ": ");
            if (sourcemap === expectedSourcemap) {
                ok('OK');
            } else if (err) {
                fail("ERROR: " + (err && err.message));
                if (isVerbose) {
                    process.stdout.write("\n");
                    process.stdout.write(err.stack + "\n");
                }
            } else {
                difference("FAIL", expectedSourcemap, sourcemap);
            }
        });
    }

    function testEmptySourcemap(name, err, compiledLess, doReplacements, sourcemap, baseFolder) {
        process.stdout.write("- " + path.join(baseFolder, name) + ": ");
        if (err) {
            fail("ERROR: " + (err && err.message));
        } else {
            var expectedSourcemap = undefined;
            if ( compiledLess !== "" ) {
                difference("\nCompiledLess must be empty", "", compiledLess);

            } else if (sourcemap !== expectedSourcemap) {
                fail("Sourcemap must be undefined");
            } else {
                ok('OK');
            }
        }
    }

    function testErrors(name, err, compiledLess, doReplacements, sourcemap, baseFolder) {
        fs.readFile(path.join(baseFolder, name) + '.txt', 'utf8', function (e, expectedErr) {
            process.stdout.write("- " + path.join(baseFolder, name) + ": ");
            expectedErr = doReplacements(expectedErr, baseFolder);
            if (!err) {
                if (compiledLess) {
                    fail("No Error", 'red');
                } else {
                    fail("No Error, No Output");
                }
            } else {
                var errMessage = less.formatError(err);
                if (errMessage === expectedErr) {
                    ok('OK');
                } else {
                    difference("FAIL", expectedErr, errMessage);
                }
            }
        });
    }

    function globalReplacements(input, directory) {
        var p = path.join(process.cwd(), directory),
            pathimport = path.join(process.cwd(), directory + "import/"),
            pathesc = p.replace(/[.:/\\]/g, function(a) { return '\\' + (a == '\\' ? '\/' : a); }),
            pathimportesc = pathimport.replace(/[.:/\\]/g, function(a) { return '\\' + (a == '\\' ? '\/' : a); });

        return input.replace(/\{path\}/g, p)
                .replace(/\{pathesc\}/g, pathesc)
                .replace(/\{pathimport\}/g, pathimport)
                .replace(/\{pathimportesc\}/g, pathimportesc)
                .replace(/\r\n/g, '\n');
    }

    function checkGlobalLeaks() {
        return Object.keys(global).filter(function(v) {
            return globals.indexOf(v) < 0;
        });
    }

    function testSyncronous(options, filenameNoExtension) {
        if (oneTestOnly && ("Test Sync " + filenameNoExtension) !== oneTestOnly) {
            return;
        }
        totalTests++;
        queue(function() {
            var isSync = true;
            toCSS(options, path.join(normalFolder, filenameNoExtension + ".less"), function (err, result) {
                process.stdout.write("- Test Sync " + filenameNoExtension + ": ");

                if (isSync) {
                    ok("OK");
                } else {
                    fail("Not Sync");
                }
                release();
            });
            isSync = false;
        });
    }

    function prepBomTest() {
        copyBom.copyFolderWithBom(normalFolder, bomFolder);
        doBomTest = true;
    }

    function runTestSet(options, foldername, verifyFunction, nameModifier, doReplacements, getFilename) {
        var options2 = options ? JSON.parse(JSON.stringify(options)) : {};
        runTestSetInternal(normalFolder, options, foldername, verifyFunction, nameModifier, doReplacements, getFilename);
        if (doBomTest) {
            runTestSetInternal(bomFolder, options2, foldername, verifyFunction, nameModifier, doReplacements, getFilename);
        }
    }

    function runTestSetNormalOnly(options, foldername, verifyFunction, nameModifier, doReplacements, getFilename) {
        runTestSetInternal(normalFolder, options, foldername, verifyFunction, nameModifier, doReplacements, getFilename);
    }

    function runTestSetInternal(baseFolder, options, foldername, verifyFunction, nameModifier, doReplacements, getFilename) {
        foldername = foldername || "";

        if (!doReplacements) {
            doReplacements = globalReplacements;
        }

        function getBasename(file) {
            return foldername + path.basename(file, '.less');
        }

        fs.readdirSync(path.join(baseFolder, foldername)).forEach(function (file) {
            if (! /\.less/.test(file)) { return; }

            var name = getBasename(file);

            if (oneTestOnly && name !== oneTestOnly) {
                return;
            }

            totalTests++;

            if (options.sourceMap && !options.sourceMap.sourceMapFileInline) {
                options.sourceMapOutputFilename = name + ".css";
                options.sourceMapBasepath = path.join(process.cwd(), baseFolder);
                options.sourceMapRootpath = "testweb/";
                // TODO separate options?
                options.sourceMap = options;
            }

            options.getVars = function(file) {
                return JSON.parse(fs.readFileSync(getFilename(getBasename(file), 'vars', baseFolder), 'utf8'));
            };

            var doubleCallCheck = false;
            queue(function() {
                toCSS(options, path.join(baseFolder, foldername + file), function (err, result) {
                if (doubleCallCheck) {
                    totalTests++;
                    fail("less is calling back twice");
                    process.stdout.write(doubleCallCheck + "\n");
                    process.stdout.write((new Error()).stack + "\n");
                    return;
                }
                doubleCallCheck = (new Error()).stack;

                if (verifyFunction) {
                    var verificationResult = verifyFunction(name, err, result && result.css, doReplacements, result && result.map, baseFolder);
                    release();
                    return verificationResult;
                }
                if (err) {
                    fail("ERROR: " + (err && err.message));
                    if (isVerbose) {
                        process.stdout.write("\n");
                        if (err.stack) {
                            process.stdout.write(err.stack + "\n");
                        } else {
                            //this sometimes happen - show the whole error object
                            console.log(err);
                        }
                    }
                    release();
                    return;
                }
                var css_name = name;
                if (nameModifier) { css_name = nameModifier(name); }
                fs.readFile(path.join('test/css', css_name) + '.css', 'utf8', function (e, css) {
                    process.stdout.write("- " + path.join(baseFolder, css_name) + ": ");

                    css = css && doReplacements(css, path.join(baseFolder, foldername));
                    if (result.css === css) { ok('OK'); }
                    else {
                        difference("FAIL", css, result.css);
                    }
                    release();
                });
            });
            });
        });
    }

    function diff(left, right) {
        require('diff').diffLines(left, right).forEach(function(item) {
            if (item.added || item.removed) {
                var text = item.value && item.value.replace("\n", String.fromCharCode(182) + "\n").replace('\ufeff', '[[BOM]]');
                process.stdout.write(stylize(text, item.added ? 'green' : 'red'));
            } else {
                process.stdout.write(item.value && item.value.replace('\ufeff', '[[BOM]]'));
            }
        });
        process.stdout.write("\n");
    }

    function fail(msg) {
        process.stdout.write(stylize(msg, 'red') + "\n");
        failedTests++;
        endTest();
    }

    function difference(msg, left, right) {
        process.stdout.write(stylize(msg, 'yellow') + "\n");
        failedTests++;

        diff(left, right);
        endTest();
    }

    function ok(msg) {
        process.stdout.write(stylize(msg, 'green') + "\n");
        passedTests++;
        endTest();
    }

    function finished() {
        isFinished = true;
        endTest();
    }

    function endTest() {
        if (isFinished && ((failedTests + passedTests) >= totalTests)) {
            var leaked = checkGlobalLeaks();

            process.stdout.write("\n");
            if (failedTests > 0) {
                process.stdout.write(failedTests + stylize(" Failed", "red") + ", " + passedTests + " passed\n");
            } else {
                process.stdout.write(stylize("All Passed ", "green") + passedTests + " run\n");
            }
            if (leaked.length > 0) {
                process.stdout.write("\n");
                process.stdout.write(stylize("Global leak detected: ", "red") + leaked.join(', ') + "\n");
            }

            if (leaked.length || failedTests) {
                process.on('exit', function() { process.reallyExit(1); });
            }
        }
    }

    function contains(fullArray, obj) {
        for (var i = 0; i < fullArray.length; i++) {
            if (fullArray[i] === obj) {
                return true;
            }
        }
        return false;
    }

    function toCSS(options, path, callback) {
        options = options || {};
        var str = fs.readFileSync(path, 'utf8'), addPath = require('path').dirname(path);
        if (typeof options.paths !== "string") {
            options.paths = options.paths || [];
            if (!contains(options.paths, addPath)) {
                options.paths.push(addPath);
            }
        }
        options.filename = require('path').resolve(process.cwd(), path);
        options.optimization = options.optimization || 0;

        if (options.globalVars) {
            options.globalVars = options.getVars(path);
        } else if (options.modifyVars) {
            options.modifyVars = options.getVars(path);
        }
        if (options.plugin) {
            var Plugin = require(require('path').resolve(process.cwd(), options.plugin));
            options.plugins = [Plugin];
        }
        less.render(str, options, callback);
    }

    function testNoOptions() {
        if (oneTestOnly && "Integration" !== oneTestOnly) {
            return;
        }
        totalTests++;
        try {
            process.stdout.write("- Integration - creating parser without options: ");
            less.render("");
        } catch(e) {
            fail(stylize("FAIL\n", "red"));
            return;
        }
        ok(stylize("OK\n", "green"));
    }

    return {
        runTestSet: runTestSet,
        runTestSetNormalOnly: runTestSetNormalOnly,
        testSyncronous: testSyncronous,
        testErrors: testErrors,
        testSourcemap: testSourcemap,
        testEmptySourcemap: testEmptySourcemap,
        testNoOptions: testNoOptions,
        prepBomTest: prepBomTest,
        finished: finished
    };
};
